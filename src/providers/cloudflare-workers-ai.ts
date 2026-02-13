import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import {
  readOpenCodeAuthField,
  readProviderConfigCandidates,
  readStringFromConfigCandidates,
} from "./provider-utils.js";

const DEFAULT_CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareAuth {
  apiToken: string;
  accountId: string;
  apiBase?: string;
}

const discoveredAccountIDs = new Map<string, string>();

function getEnvOrNull(key: string): string | null {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : null;
}

async function getAuth(): Promise<CloudflareAuth | null> {
  const envToken = getEnvOrNull("CLOUDFLARE_API_TOKEN");
  const envTokenAlias = getEnvOrNull("CF_API_TOKEN");
  const envAccount = getEnvOrNull("CLOUDFLARE_ACCOUNT_ID");
  const envAccountAlias = getEnvOrNull("CF_ACCOUNT_ID") ?? getEnvOrNull("CLOUDFLARE_ACCOUNT");
  const envApiBase = getEnvOrNull("CLOUDFLARE_API_BASE_URL") || undefined;

  const tokenFromEnv = envToken ?? envTokenAlias;
  const accountFromEnv = envAccount ?? envAccountAlias;

  if (tokenFromEnv && accountFromEnv) {
    return {
      apiToken: tokenFromEnv,
      accountId: accountFromEnv,
      apiBase: envApiBase,
    };
  }

  const configFiles = [
    "cloudflare-auth.json",
    "cloudflare.json",
    "cloudflare-workers-ai-auth.json",
    "workers-ai-auth.json",
  ];

  const cfg = await readProviderConfigCandidates(configFiles);
  if (!cfg) return null;

  const apiToken = await readStringFromConfigCandidates(configFiles, [
    "apiToken",
    "api_token",
    "token",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
  ]);
  const accountId = await readStringFromConfigCandidates(configFiles, [
    "accountId",
    "account_id",
    "account",
    "id",
    "CLOUDFLARE_ACCOUNT_ID",
    "CF_ACCOUNT_ID",
  ]);
  const apiBase =
    (await readStringFromConfigCandidates(configFiles, [
      "apiBase",
      "api_base",
      "baseUrl",
      "base_url",
      "CLOUDFLARE_API_BASE_URL",
    ])) ||
    undefined;

  const tokenFromOpenCode = await readOpenCodeAuthField(
    ["cloudflare", "cloudflare-workers-ai", "workers-ai"],
    ["apiToken", "api_token", "token", "accessToken", "access_token", "key"],
  );
  const accountFromOpenCode = await readOpenCodeAuthField(
    ["cloudflare", "cloudflare-workers-ai", "workers-ai"],
    ["accountId", "account_id", "account", "id"],
  );

  const resolvedToken = apiToken ?? tokenFromOpenCode;
  let resolvedAccount = accountId ?? accountFromOpenCode;

  if (!resolvedToken) return null;

  if (!resolvedAccount) {
    const cached = discoveredAccountIDs.get(resolvedToken);
    if (cached) {
      resolvedAccount = cached;
    }
  }

  if (!resolvedAccount) {
    const discovered = await discoverAccountId(resolvedToken, apiBase);
    if (discovered) {
      resolvedAccount = discovered;
      discoveredAccountIDs.set(resolvedToken, discovered);
    }
  }

  if (!resolvedAccount) return null;
  return {
    apiToken: resolvedToken,
    accountId: resolvedAccount,
    apiBase,
  };
}

async function discoverAccountId(token: string, apiBase?: string): Promise<string | null> {
  const base = apiBase || DEFAULT_CF_API_BASE;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);

  try {
    const res = await fetch(`${base}/accounts?per_page=2`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) return null;

    const body = (await res.json()) as {
      success?: boolean;
      result?: Array<{ id?: string }>;
    };
    if (!body.success || !Array.isArray(body.result)) return null;
    if (body.result.length !== 1) return null;
    const id = body.result[0]?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchQuota(auth: CloudflareAuth): Promise<QuotaData[]> {
  const base = auth.apiBase || DEFAULT_CF_API_BASE;
  const url = `${base}/accounts/${auth.accountId}/ai/models/search?per_page=1`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${auth.apiToken}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    const text = await res.text();
    if (res.status === 429) {
      return [
        {
          id: "cloudflare-ai-limit",
          providerName: "Cloudflare Workers AI",
          used: 100,
          limit: 100,
          unit: "%",
          info: "rate limited (429)",
        },
      ];
    }

    if (!res.ok) {
      throw new Error(`Cloudflare API ${res.status}: ${text}`);
    }

    return [
      {
        id: "cloudflare-ai-status",
        providerName: "Cloudflare Workers AI",
        used: 0,
        limit: null,
        unit: "status",
        info: "connected (usage is dashboard-only)",
      },
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export function createCloudflareWorkersAIProvider(): IQuotaProvider {
  return {
    id: "cloudflare-workers-ai",
    async fetchQuota(): Promise<QuotaData[]> {
      const auth = await getAuth();
      if (!auth) {
        const token =
          getEnvOrNull("CLOUDFLARE_API_TOKEN") ??
          getEnvOrNull("CF_API_TOKEN") ??
          (await readOpenCodeAuthField(
            ["cloudflare", "cloudflare-workers-ai", "workers-ai"],
            ["apiToken", "api_token", "token", "accessToken", "access_token", "key"],
          ));

        if (!token) {
          logger.debug("[cloudflare-workers-ai] Missing auth (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID or ~/.config/opencode/cloudflare-auth.json)");
          return [];
        }

        return [{
          id: "cloudflare-ai-status",
          providerName: "Cloudflare Workers AI",
          used: 0,
          limit: null,
          unit: "status",
          info: "token detected; set CLOUDFLARE_ACCOUNT_ID or grant account-list permission",
        }];
      }

      try {
        return await fetchQuota(auth);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[cloudflare-workers-ai] fetch failed: ${message}`);
        return [{
          id: "cloudflare-ai-status",
          providerName: "Cloudflare Workers AI",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
