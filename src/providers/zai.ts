/**
 * z.ai (Grok / GLM) quota provider.
 *
 * Auth: API key from env Z_AI_API_KEY or plugin config.
 * Endpoint: GET https://api.z.ai/api/monitor/usage/quota/limit
 *   China fallback: https://open.bigmodel.cn/api/monitor/usage/quota/limit
 *   Override: Z_AI_QUOTA_URL or Z_AI_API_HOST env vars.
 *
 * Returns TOKENS_LIMIT and TIME_LIMIT quota entries.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { QuotaData, IQuotaProvider } from "../interfaces.js";
import { logger } from "../logger.js";

// ---------- Auth ----------

async function getApiKey(): Promise<string | null> {
  // 1. Env var
  if (process.env.Z_AI_API_KEY) return process.env.Z_AI_API_KEY;

  // 2. Config file
  try {
    const configPath = join(homedir(), ".config", "opencode", "zai-config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    if (config.apiKey) return config.apiKey;
  } catch {
    // no config
  }

  return null;
}

function getEndpoint(): string {
  if (process.env.Z_AI_QUOTA_URL) return process.env.Z_AI_QUOTA_URL;
  const host = process.env.Z_AI_API_HOST || "https://api.z.ai";
  return `${host}/api/monitor/usage/quota/limit`;
}

// ---------- API ----------

interface ZaiLimit {
  type: string; // "TOKENS_LIMIT" | "TIME_LIMIT"
  used: number;
  total: number;
  unit: string;
  windowDuration?: { unit: string; number: number };
  nextResetTime?: number; // epoch ms
}

interface ZaiResponse {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    planName?: string;
    plan?: string;
    limits?: ZaiLimit[];
  };
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `${days}d ${remH}h`;
  }
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

async function fetchQuota(apiKey: string): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(getEndpoint(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`z.ai API ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as ZaiResponse;
    
    // Check if we got a generic success without quota data
    if (!body.data?.limits) {
      // Return status info instead of empty
      return [{
        id: "zai-status",
        providerName: "z.ai",
        used: 0,
        limit: null,
        unit: "status",
        info: body.msg || "API connected (no quota data)",
      }];
    }
    
    const data = body.data!;
    const plan = data.planName || data.plan || "z.ai";
    const results: QuotaData[] = [];

    for (const limit of data.limits!) {
      const resetMs = limit.nextResetTime
        ? limit.nextResetTime - Date.now()
        : undefined;
      const window = limit.windowDuration
        ? `${limit.windowDuration.number}${limit.windowDuration.unit.toLowerCase().charAt(0)} window`
        : undefined;

      if (limit.type === "TOKENS_LIMIT") {
        results.push({
          id: "zai-tokens",
          providerName: "z.ai",
          used: limit.used,
          limit: limit.total,
          unit: limit.unit?.toLowerCase() || "tokens",
          window,
          reset: resetMs != null && resetMs > 0 ? formatDuration(resetMs) : undefined,
          info: plan,
        });
      } else if (limit.type === "TIME_LIMIT") {
        results.push({
          id: "zai-time",
          providerName: "z.ai",
          used: limit.used,
          limit: limit.total,
          unit: "minutes",
          window,
          reset: resetMs != null && resetMs > 0 ? formatDuration(resetMs) : undefined,
          info: `${plan} (MCP)`,
        });
      }
    }

    return results;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Export ----------

export function createZaiProvider(): IQuotaProvider {
  return {
    id: "zai",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await getApiKey();
      if (!apiKey) {
        logger.debug("[zai] No API key (set Z_AI_API_KEY or ~/.config/opencode/zai-config.json)");
        return [];
      }
      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        logger.debug(`[zai] fetch failed: ${err instanceof Error ? err.message : err}`);
        return [];
      }
    },
  };
}
