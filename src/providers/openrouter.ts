import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import { readApiKey, toNumber } from "./provider-utils.js";

const OPENROUTER_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asData(payload: unknown): Record<string, unknown> {
  if (!isObject(payload)) return {};
  const data = payload.data;
  return isObject(data) ? data : payload;
}

async function fetchQuota(apiKey: string): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(OPENROUTER_KEY_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenRouter key API ${res.status}: ${await res.text()}`);
    }

    const body = await res.json();
    const data = asData(body);
    const entries: QuotaData[] = [];

    const limit = toNumber(data.limit);
    const remaining = toNumber(data.limit_remaining);
    const usage = toNumber(data.usage);

    if (limit !== null && remaining !== null) {
      entries.push({
        id: "openrouter-credits",
        providerName: "OpenRouter Credits",
        used: Math.max(0, Math.min(limit, limit - remaining)),
        limit,
        unit: "credits",
        info: typeof data.is_free_tier === "boolean" ? (data.is_free_tier ? "free tier" : "paid tier") : undefined,
      });
    }

    if (entries.length > 0) return entries;

    if (usage !== null) {
      return [
        {
          id: "openrouter-usage",
          providerName: "OpenRouter Usage",
          used: usage,
          limit: null,
          unit: "usd",
          info: "all-time usage (limit unavailable)",
        },
      ];
    }

    return [
      {
        id: "openrouter-status",
        providerName: "OpenRouter",
        used: 0,
        limit: null,
        unit: "status",
        info: usage !== null ? `connected (usage=${usage})` : "connected (no limit fields)",
      },
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export function createOpenRouterProvider(): IQuotaProvider {
  return {
    id: "openrouter",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["OPENROUTER_API_KEY", "OPENROUTER_KEY", "OR_API_KEY"],
        ["openrouter-auth.json", "openrouter.json", "openrouter-config.json"],
        ["apiKey", "api_key", "apiToken", "token", "openrouterApiKey", "OPENROUTER_API_KEY", "key"],
        ["openrouter"],
      );
      if (!apiKey) {
        logger.debug("[openrouter] No API key (OPENROUTER_API_KEY or ~/.config/opencode/openrouter-auth.json)");
        return [];
      }

      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[openrouter] fetch failed: ${message}`);
        return [{
          id: "openrouter-status",
          providerName: "OpenRouter",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
