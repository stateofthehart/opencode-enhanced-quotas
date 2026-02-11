import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { logger } from "../logger.js";

/**
 * Gemini OAuth token refresh utility.
 *
 * Refreshes expired access tokens using Google's OAuth2 endpoint.
 * Based on the pattern from opencode-gemini-auth package.
 */

const GEMINI_OAUTH_PATH = () => join(homedir(), ".gemini", "oauth_creds.json");

interface GeminiCredentials {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    id_token?: string;
}

interface TokenRefreshResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
}

interface GeminiOAuthClient {
    clientId: string;
    clientSecret: string;
}

const OAUTH_CLIENT_ID_REGEX = /OAUTH_CLIENT_ID\s*=\s*['\"]([\w\-.]+)['\"]/;
const OAUTH_CLIENT_SECRET_REGEX = /OAUTH_CLIENT_SECRET\s*=\s*['\"]([\w\-]+)['\"]/;

function safeRead(path: string): string | null {
    try {
        if (!existsSync(path)) return null;
        return execSync(`cat "${path}"`, { encoding: "utf-8", timeout: 3000 });
    } catch {
        return null;
    }
}

function findGeminiBinaryPath(): string | null {
    try {
        const output = execSync("which gemini", { encoding: "utf-8", timeout: 3000 }).trim();
        if (!output) return null;
        try {
            return execSync(`readlink -f "${output}"`, { encoding: "utf-8", timeout: 3000 }).trim();
        } catch {
            return output;
        }
    } catch {
        return null;
    }
}

function candidateOauth2JsPaths(geminiBinPath: string): string[] {
    const binDir = dirname(geminiBinPath);
    return [
        resolve(binDir, "../libexec/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
        resolve(binDir, "../lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
        resolve(binDir, "../node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
        resolve(binDir, "../share/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
        resolve(binDir, "../gemini-cli-core/dist/src/code_assist/oauth2.js"),
        resolve(binDir, "node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
    ];
}

function extractOAuthClientFromJs(content: string): GeminiOAuthClient | null {
    const idMatch = content.match(OAUTH_CLIENT_ID_REGEX);
    const secretMatch = content.match(OAUTH_CLIENT_SECRET_REGEX);
    if (!idMatch || !secretMatch) return null;
    return {
        clientId: idMatch[1],
        clientSecret: secretMatch[1],
    };
}

function getGeminiOAuthClient(): GeminiOAuthClient | null {
    const geminiBin = findGeminiBinaryPath();
    if (geminiBin) {
        for (const candidate of candidateOauth2JsPaths(geminiBin)) {
            const content = safeRead(candidate);
            if (!content) continue;
            const parsed = extractOAuthClientFromJs(content);
            if (parsed) return parsed;
        }
    }

    const envClientId = process.env.GEMINI_OAUTH_CLIENT_ID?.trim();
    const envClientSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET?.trim();
    if (envClientId && envClientSecret) {
        return {
            clientId: envClientId,
            clientSecret: envClientSecret,
        };
    }

    return null;
}

/**
 * Check if the access token is expired (with 5 minute buffer)
 */
export function isTokenExpired(expiryDate: number | undefined): boolean {
    if (!expiryDate) return true;
    // Add 5 minute buffer to handle clock skew
    return Date.now() > (expiryDate - 5 * 60 * 1000);
}

/**
 * Refresh the Gemini OAuth access token using the refresh token
 */
export async function refreshGeminiToken(): Promise<string | null> {
    try {
        // Read current credentials
        const credsPath = GEMINI_OAUTH_PATH();
        const raw = await readFile(credsPath, "utf-8");
        const creds: GeminiCredentials = JSON.parse(raw);

        if (!creds.refresh_token) {
            logger.warn("gemini_auth:no_refresh_token", {
                message: "No refresh token found; run 'gemini auth login'",
            });
            return null;
        }

        // Check if refresh is needed
        if (!isTokenExpired(creds.expiry_date)) {
            return creds.access_token || null;
        }

        logger.debug("gemini_auth:token_expired_refreshing");

        const oauthClient = getGeminiOAuthClient();
        if (!oauthClient) {
            logger.error("gemini_auth:oauth_client_missing");
            return null;
        }

        // Google OAuth2 token refresh endpoint (CodexBar-compatible)
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `client_id=${oauthClient.clientId}&client_secret=${oauthClient.clientSecret}&refresh_token=${creds.refresh_token}&grant_type=refresh_token`,
        });

        if (!response.ok) {
            const error = await response.text();
            logger.error("gemini_auth:token_refresh_failed", { error });
            // Fallback: keep using current access token if present.
            // Some environments issue non-refreshable tokens but they can still work
            // for quota endpoints briefly.
            return creds.access_token || null;
        }

        const data: TokenRefreshResponse = await response.json();

        // Update credentials with new token
        const newExpiryDate = Date.now() + data.expires_in * 1000;
        const updatedCreds: GeminiCredentials = {
            ...creds,
            access_token: data.access_token,
            expiry_date: newExpiryDate,
        };

        await writeFile(credsPath, JSON.stringify(updatedCreds, null, 2));
        logger.info("gemini_auth:token_refreshed", {
            expiresAt: new Date(newExpiryDate).toISOString(),
        });

        return data.access_token;
    } catch (error) {
        logger.error("gemini_auth:refresh_exception", { error });
        // Fallback to existing token if available.
        try {
            const raw = await readFile(GEMINI_OAUTH_PATH(), "utf-8");
            const creds: GeminiCredentials = JSON.parse(raw);
            return creds.access_token || null;
        } catch {
            return null;
        }
    }
}

/**
 * Get valid access token (refreshing if necessary)
 */
export async function getValidGeminiToken(): Promise<string | null> {
    try {
        const credsPath = GEMINI_OAUTH_PATH();
        const raw = await readFile(credsPath, "utf-8");
        const creds: GeminiCredentials = JSON.parse(raw);

        if (!creds.access_token) {
            return null;
        }

        // Check if expired and refresh if needed
        if (isTokenExpired(creds.expiry_date)) {
            return await refreshGeminiToken();
        }

        return creds.access_token;
    } catch {
        return null;
    }
}

/**
 * Start a login flow helper for Gemini OAuth.
 * Gemini auth is managed by the official Gemini CLI.
 */
export async function startGeminiLoginServer(): Promise<boolean> {
    console.log("\n📱 Gemini Authentication\n");
    console.log("To authenticate with Gemini, please use the official Gemini CLI:\n");
    console.log("  1. Install Gemini CLI (if not already installed):");
    console.log("     curl -sSL https://gemini.google.com/cli/install | bash");
    console.log("");
    console.log("  2. Run the login command:");
    console.log("     gemini auth login");
    console.log("");
    console.log("  3. After logging in, run 'opencode-quotas' to see your quotas.\n");
    
    return false;
}
