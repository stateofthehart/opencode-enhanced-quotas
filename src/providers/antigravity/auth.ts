import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ANTIGRAVITY_ACCOUNTS_FILE, AUTH_FILE } from "../../utils/paths.js";

/**
 * PUBLIC OAUTH CREDENTIALS - INTENTIONALLY COMMITTED
 * 
 * These are "Installed Application" credentials for Google's Native App OAuth flow.
 * Per Google's documentation, the client_secret for native applications is NOT
 * considered confidential. Security relies solely on the user's refresh_token
 * stored locally in ~/.config/opencode/antigravity-accounts.json.
 * 
 * See: https://developers.google.com/identity/protocols/oauth2/native-app
 */
const ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"; // gitleaks:allow
const ANTIGRAVITY_CLIENT_SECRET = "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"; // gitleaks:allow
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface StoredAccount {
  email: string;
  refreshToken?: string;
  refresh_token?: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
}

interface AccountsFile {
  version: number;
  accounts: StoredAccount[];
  activeIndex: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface OpenCodeGoogleAuth {
  access?: string;
  refresh?: string;
  expires?: number;
}

export interface CloudAuthCredentials {
  accessToken: string;
  projectId?: string;
  email: string;
}

interface CachedCredential extends CloudAuthCredentials {
  expiresAt: number;
}

let cachedCredential: CachedCredential | null = null;

function getAccountsFilePath(): string {
  return ANTIGRAVITY_ACCOUNTS_FILE();
}

function getLegacyAccountsFilePath(): string {
  return join(homedir(), ".opencode", "antigravity-accounts.json");
}

async function loadAccounts(): Promise<AccountsFile> {
  const primaryPath = getAccountsFilePath();
  const legacyPath = getLegacyAccountsFilePath();
  const paths = primaryPath === legacyPath ? [primaryPath] : [primaryPath, legacyPath];

  for (const accountsPath of paths) {
    try {
      const content = await readFile(accountsPath, "utf-8");
      const data = JSON.parse(content) as AccountsFile;

      if (!data.accounts || data.accounts.length === 0) {
        throw new Error("No accounts found in antigravity-accounts.json");
      }

      let normalized = false;
      const normalizedAccounts = data.accounts.map((account) => {
        if (!account.refreshToken && account.refresh_token) {
          normalized = true;
          const { refresh_token, ...rest } = account;
          return {
            ...rest,
            refreshToken: refresh_token,
          };
        }
        return account;
      });

      const normalizedData: AccountsFile = {
        ...data,
        accounts: normalizedAccounts,
      };

      if (normalized) {
        try {
          await writeFile(accountsPath, JSON.stringify(normalizedData, null, 2));
        } catch {
          // Best-effort persistence: keep working with normalized in-memory data.
        }
      }

      return normalizedData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    "Antigravity accounts file not found.\n" +
      "Run 'opencode auth login' first to authenticate with Google.",
  );
}

async function loadOpenCodeGoogleAuth(): Promise<OpenCodeGoogleAuth | null> {
  try {
    const raw = await readFile(AUTH_FILE(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const google = parsed.google;
    if (!google || typeof google !== "object" || Array.isArray(google)) return null;

    const rec = google as Record<string, unknown>;
    return {
      access: typeof rec.access === "string" ? rec.access : undefined,
      refresh: typeof rec.refresh === "string" ? rec.refresh : undefined,
      expires: typeof rec.expires === "number" ? rec.expires : undefined,
    };
  } catch {
    return null;
  }
}

async function getOpenCodeGoogleAccessToken(): Promise<{ accessToken: string; expiresAt?: number } | null> {
  const googleAuth = await loadOpenCodeGoogleAuth();
  if (!googleAuth?.access) return null;

  // Use only if token is still valid (with 5 minute buffer).
  if (typeof googleAuth.expires === "number") {
    const fiveMinutesInMs = 5 * 60 * 1000;
    if (googleAuth.expires <= Date.now() + fiveMinutesInMs) {
      return null;
    }
  }

  return {
    accessToken: googleAuth.access,
    expiresAt: googleAuth.expires,
  };
}

export async function hasCloudCredentials(): Promise<boolean> {
  try {
    await loadAccounts();
    return true;
  } catch {
    return (await getOpenCodeGoogleAccessToken()) !== null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.toLowerCase().includes("invalid_grant")) {
      throw new Error(
        "Refresh token is invalid or expired. Run 'opencode auth login' to re-authenticate.",
      );
    }
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function getCloudCredentials(): Promise<CloudAuthCredentials> {
  let accountsFile: AccountsFile | null = null;
  try {
    accountsFile = await loadAccounts();
  } catch {
    // Fallback path: if OpenCode Google OAuth access token exists and is valid,
    // use it directly even when accounts file is missing or stale.
    const googleToken = await getOpenCodeGoogleAccessToken();
    if (googleToken) {
      cachedCredential = {
        accessToken: googleToken.accessToken,
        expiresAt: googleToken.expiresAt ?? Date.now() + 10 * 60 * 1000,
        email: "google-oauth",
      };

      return {
        accessToken: googleToken.accessToken,
        email: "google-oauth",
      };
    }
    throw new Error(
      "Antigravity credentials missing or expired. Run 'opencode auth login' and ensure antigravity accounts are available.",
    );
  }

  const activeAccount =
    accountsFile.accounts[accountsFile.activeIndex] ?? accountsFile.accounts[0];

  if (!activeAccount) {
    throw new Error("No active account found in antigravity-accounts.json");
  }

  // Check cache (5 min buffer)
  const fiveMinutesInMs = 5 * 60 * 1000;
  if (
    cachedCredential &&
    cachedCredential.email === activeAccount.email &&
    cachedCredential.expiresAt > Date.now() + fiveMinutesInMs
  ) {
    return {
      accessToken: cachedCredential.accessToken,
      projectId: cachedCredential.projectId,
      email: cachedCredential.email,
    };
  }

  const refreshToken = activeAccount.refreshToken ?? activeAccount.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "Active Antigravity account is missing a refresh token. Run 'opencode auth login'.",
    );
  }

  let accessToken: string;
  let expiresAt: number;
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.accessToken;
    expiresAt = refreshed.expiresAt;
  } catch (error) {
    // Fallback to OpenCode Google OAuth token if refresh token is invalid.
    const fallback = await getOpenCodeGoogleAccessToken();
    if (!fallback) throw error;
    accessToken = fallback.accessToken;
    expiresAt = fallback.expiresAt ?? Date.now() + 10 * 60 * 1000;
  }
  const projectId = activeAccount.projectId ?? activeAccount.managedProjectId;
  
  cachedCredential = {
    accessToken,
    projectId,
    email: activeAccount.email,
    expiresAt,
  };

  return {
    accessToken,
    projectId,
    email: activeAccount.email,
  };
}

/**
 * Reset the credential cache. Internal use only (primarily for tests).
 */
export function resetCredentialCache(): void {
    cachedCredential = null;
}
