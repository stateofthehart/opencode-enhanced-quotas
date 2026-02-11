/**
 * Cursor AI quota provider.
 *
 * Auth strategies (in order):
 * 1. Environment variable: CURSOR_COOKIE
 * 2. Plugin config: ~/.config/opencode/cursor-auth.json
 * 3. cursor-agent config (headless):
 *    - ~/.cursor/auth.json
 *    - ~/.config/cursor/cli-config.json
 *    - ~/.config/cursor/auth.json
 * 4. Cursor IDE database (requires IDE installation):
 *    - ~/.config/Cursor/User/globalStorage/state.vscdb
 *    - ~/.cursor/User/globalStorage/state.vscdb
 *
 * Endpoint: GET https://www.cursor.com/api/usage
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { QuotaData, IQuotaProvider } from "../interfaces.js";
import { logger } from "../logger.js";

// ---------- Auth Types ----------

interface CursorAuth {
  userId?: string;
  cookie: string;
}

function normalizeCookieHeader(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  if (value.startsWith("Cookie:")) return value.slice(7).trim();
  // Already a cookie pair/header.
  if (value.includes("=")) return value;
  // Bare token value.
  return `WorkosCursorSessionToken=${value}`;
}

// Legacy auth.json format
interface CursorAuthJson {
  accessToken?: string;
  refreshToken?: string;
}

// Newer cli-config.json format
interface CursorCliConfig {
  auth?: {
    accessToken?: string;
    refreshToken?: string;
  };
}

// ---------- Paths ----------

const AGENT_AUTH_PATHS = [
  join(homedir(), ".cursor", "auth.json"),
  join(homedir(), ".config", "cursor", "cli-config.json"),
  join(homedir(), ".config", "cursor", "auth.json"),
];

const IDE_DB_PATHS = [
  join(homedir(), ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
  join(homedir(), ".cursor", "User", "globalStorage", "state.vscdb"),
];

// ---------- Helpers ----------

/** Decode a base64url string (no padding). */
function b64url(s: string): string {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/** Parse JWT payload without verification. */
function parseJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return {};
    return JSON.parse(b64url(parts[1]));
  } catch {
    return {};
  }
}

function buildAuthFromToken(token: string): CursorAuth | null {
  const payload = parseJwtPayload(token);
  const sub = payload.sub as string | undefined;
  
  if (!sub) return null;

  // Check expiry
  const exp = payload.exp as number | undefined;
  if (exp && Date.now() / 1000 > exp) {
    logger.debug("[cursor] Token expired", { exp });
  }

  return {
    userId: sub,
    cookie: `WorkosCursorSessionToken=${encodeURIComponent(sub)}%3A%3A${token}`,
  };
}

// ---------- Auth Strategies ----------

async function readTokenFromAgentFiles(): Promise<CursorAuth | null> {
  for (const path of AGENT_AUTH_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const content = await readFile(path, "utf-8");
      const json = JSON.parse(content);
      
      // Handle both formats
      const token = (json as CursorAuthJson).accessToken || 
                    (json as CursorCliConfig).auth?.accessToken;

      if (token) {
        const auth = buildAuthFromToken(token);
        if (auth) {
          logger.debug("[cursor] Found auth in agent file", { path });
          return auth;
        }
      }
    } catch (e) {
      logger.debug("[cursor] Failed to read agent file", { path, error: e });
    }
  }
  return null;
}

async function readTokenFromIdeDb(): Promise<CursorAuth | null> {
  // Use sqlite3 via child_process since there's no native binding
  const { execSync } = await import("node:child_process");

  for (const dbPath of IDE_DB_PATHS) {
    if (!existsSync(dbPath)) continue;
    try {
      const token = execSync(
        `sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'" 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 },
      ).trim();

      if (token) {
        const auth = buildAuthFromToken(token);
        if (auth) return auth;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function getAuth(): Promise<CursorAuth | null> {
  // 1. Env var
  const envCookie = process.env.CURSOR_COOKIE;
  if (envCookie) {
    const match = envCookie.match(/WorkosCursorSessionToken=([^:]+)%3A%3A/);
    const userId = match ? decodeURIComponent(match[1]) : "unknown";
    return { userId, cookie: envCookie };
  }

  // 2. Plugin config file
  try {
    const configPath = join(homedir(), ".config", "opencode", "cursor-auth.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      if (config.cookie) {
        return { userId: config.userId || undefined, cookie: normalizeCookieHeader(config.cookie) };
      }
    }
  } catch {
    // ignore
  }

  // 3. Browser cookies (CodexBar-style primary source for usage API)
  try {
    const { buildCursorCookieHeader } = await import("../utils/cursor-auth.js");
    const browserCookie = await buildCursorCookieHeader();
    if (browserCookie) {
      logger.debug("[cursor] Found browser cookie auth");
      // Extract userId from cookie
      const match = browserCookie.match(/WorkosCursorSessionToken=([^:]+)%3A%3A/);
      const userId = match ? decodeURIComponent(match[1]) : "unknown";
      return { userId, cookie: browserCookie };
    }
  } catch (e) {
    logger.debug("[cursor] Browser cookie auth failed", { error: e });
  }

  // 4. cursor-agent config (headless fallback; may not work for usage API)
  const agentAuth = await readTokenFromAgentFiles();
  if (agentAuth) return agentAuth;

  // 5. Cursor IDE database
  return readTokenFromIdeDb();
}

// ---------- API ----------

interface CursorUsageLegacyResponse {
  [model: string]: {
    numRequests: number;
    numRequestsTotal?: number;
    numTokens: number;
    numTokensTotal?: number;
  };
}

interface UsageSummaryPlan {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
  totalPercentUsed?: number;
}

interface UsageSummaryOnDemand {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
}

interface UsageSummaryResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  individualUsage?: {
    plan?: UsageSummaryPlan;
    onDemand?: UsageSummaryOnDemand;
  };
  teamUsage?: {
    onDemand?: UsageSummaryOnDemand;
  };
}

interface CursorMeResponse {
  sub?: string;
  email?: string;
  name?: string;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days}d ${remHours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function fetchUsage(auth: CursorAuth): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const headers = {
      Cookie: auth.cookie,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0",
      Accept: "application/json",
    };

    // CodexBar primary endpoint: usage-summary
    const summaryRes = await fetch("https://cursor.com/api/usage-summary", {
      headers,
      signal: ctrl.signal,
    });

    if (summaryRes.status === 401 || summaryRes.status === 403) {
      throw new Error(`Cursor API ${summaryRes.status}: not authenticated`);
    }

    const results: QuotaData[] = [];

    if (summaryRes.ok) {
      const summary = (await summaryRes.json()) as UsageSummaryResponse;
      const plan = summary.individualUsage?.plan;
      const onDemand = summary.individualUsage?.onDemand;
      const cycleEnd = summary.billingCycleEnd ? new Date(summary.billingCycleEnd).getTime() : null;
      const reset = cycleEnd ? formatDuration(cycleEnd - Date.now()) : undefined;

      if (plan?.enabled && plan.limit != null) {
        const used = plan.used ?? 0;
        const limit = plan.limit;
        results.push({
          id: "cursor-requests",
          providerName: "Cursor Usage",
          used,
          limit,
          unit: "credits",
          reset,
          info: summary.membershipType ? `plan: ${summary.membershipType}` : undefined,
        });
      } else if (plan?.enabled && plan.used != null) {
        results.push({
          id: "cursor-requests",
          providerName: "Cursor Usage",
          used: plan.used,
          limit: null,
          unit: "credits",
          reset,
          info: summary.membershipType ? `plan: ${summary.membershipType}` : undefined,
        });
      }

      if (onDemand?.enabled) {
        results.push({
          id: "cursor-ondemand",
          providerName: "Cursor On-Demand",
          used: onDemand.used ?? 0,
          limit: onDemand.limit ?? null,
          unit: "credits",
          reset,
        });
      }
    }

    // Optional legacy endpoint for request/token counts
    let sub = auth.userId;
    if (!sub) {
      try {
        const meRes = await fetch("https://cursor.com/api/auth/me", {
          headers,
          signal: ctrl.signal,
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as CursorMeResponse;
          sub = me.sub;
        }
      } catch {
        // optional
      }
    }

    if (sub) {
      const legacyUrl = `https://cursor.com/api/usage?user=${encodeURIComponent(sub)}`;
      const res = await fetch(legacyUrl, {
        headers,
        signal: ctrl.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as CursorUsageLegacyResponse;
        let totalRequests = 0;
        let totalTokens = 0;
        for (const [model, usage] of Object.entries(data)) {
          if (model === "startOfMonth") continue;
          if (typeof usage !== "object" || !usage) continue;
          totalRequests += usage.numRequests || 0;
          totalTokens += usage.numTokens || 0;
        }

        if (!results.find((r) => r.id === "cursor-requests")) {
          results.push({
            id: "cursor-requests",
            providerName: "Cursor Usage",
            used: totalRequests,
            limit: null,
            unit: "requests",
            info: "legacy endpoint",
          });
        }

        if (totalTokens > 0) {
          results.push({
            id: "cursor-tokens",
            providerName: "Cursor Tokens",
            used: totalTokens,
            limit: null,
            unit: "tokens",
          });
        }
      }
    }

    if (results.length > 0) {
      return results;
    }

    // No usable data but authenticated call may still succeed with empty payload.
    return [{
      id: "cursor-requests",
      providerName: "Cursor Usage",
      used: 0,
      limit: null,
      unit: "requests",
      info: "No usage data returned by Cursor API",
    }];
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Export ----------

export function createCursorProvider(): IQuotaProvider {
  return {
    id: "cursor",
    async fetchQuota(): Promise<QuotaData[]> {
      const auth = await getAuth();
      if (!auth) {
        logger.debug("[cursor] No auth found (checked env, agent files, and IDE db)");
        return [{
          id: "cursor-requests",
          providerName: "Cursor",
          used: 0,
          limit: null,
          unit: "requests",
          info: "No Cursor session found. Login at cursor.com and install libsecret + gnome-keyring on Linux.",
        }];
      }
      try {
        return await fetchUsage(auth);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.debug(`[cursor] fetch failed: ${message}`);
        return [{
          id: "cursor-requests",
          providerName: "Cursor",
          used: 0,
          limit: null,
          unit: "requests",
          info: `Auth/session issue: ${message}`,
        }];
      }
    },
  };
}
