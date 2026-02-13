/**
 * MiniMax coding plan quota provider.
 *
 * Auth: API key from env MINIMAX_API_KEY or plugin config.
 * Endpoint: GET https://api.minimax.io/v1/coding_plan/remains
 *   China: https://platform.minimaxi.com/v1/api/openplatform/coding_plan/remains
 *   Override: MINIMAX_REMAINS_URL or MINIMAX_HOST env vars.
 *
 * Returns prompts used/total in a 5-hour rolling window.
 */

import type { QuotaData, IQuotaProvider } from "../interfaces.js";
import { logger } from "../logger.js";
import { readApiKey } from "./provider-utils.js";

// ---------- Auth ----------

async function getApiKey(): Promise<string | null> {
  return readApiKey(
    ["MINIMAX_API_KEY", "MINIMAX_KEY"],
    ["minimax-config.json", "minimax-auth.json", "minimax.json"],
    ["apiKey", "api_key", "token", "key", "MINIMAX_API_KEY"],
    ["minimax", "minimaxio", "minimax.io"],
  );
}

function getEndpoints(): string[] {
  if (process.env.MINIMAX_REMAINS_URL) return [process.env.MINIMAX_REMAINS_URL];

  const envHost = process.env.MINIMAX_HOST;
  const hosts = envHost
    ? [envHost]
    : ["https://api.minimax.io", "https://api.minimaxi.com", "https://platform.minimax.io"];

  const paths = [
    "/v1/coding_plan/remains",
    "/v1/api/openplatform/coding_plan/remains",
  ];

  const endpoints: string[] = [];
  for (const host of hosts) {
    const normalizedHost = host.replace(/\/$/, "");
    for (const path of paths) {
      endpoints.push(`${normalizedHost}${path}`);
    }
  }

  return endpoints;
}

// ---------- API ----------

interface MiniMaxResponse {
  model_remains?: {
    used: number;
    total: number;
    start_time?: string;
    end_time?: string;
    remains_time?: string;
  } | null;
  plan_name?: string;
  base_resp?: {
    status_code: number;
    status_msg: string;
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
    let data: MiniMaxResponse | null = null;
    let lastError: string | null = null;

    for (const endpoint of getEndpoints()) {
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: ctrl.signal,
      });

      if (!res.ok) {
        lastError = `MiniMax API ${res.status} @ ${endpoint}: ${await res.text()}`;
        continue;
      }

      data = (await res.json()) as MiniMaxResponse;
      break;
    }

    if (!data) {
      throw new Error(lastError ?? "MiniMax remains API failed on all endpoints");
    }
    
    // Check for error response (e.g., not coding plan token)
    if (data.base_resp && data.base_resp.status_code !== 0) {
      return [{
        id: "minimax-status",
        providerName: "MiniMax",
        used: 0,
        limit: null,
        unit: "status",
        info: data.base_resp.status_msg
          .replace(/insufficient\s+balance/i, "insufficient balance (billing)")
          .replace(/insufficient\s+quota/i, "insufficient quota (billing)"),
      }];
    }
    
    if (!data.model_remains) return [];

    const { used, total, end_time, remains_time } = data.model_remains;
    const plan = data.plan_name || "MiniMax";

    // Calculate reset time
    const resetStr = remains_time || end_time;
    let resetLabel: string | undefined;
    if (resetStr) {
      const resetMs = new Date(resetStr).getTime() - Date.now();
      if (resetMs > 0) resetLabel = formatDuration(resetMs);
    }

    return [
      {
        id: "minimax-prompts",
        providerName: "MiniMax",
        used,
        limit: total,
        unit: "prompts",
        window: "5h window",
        reset: resetLabel,
        info: plan,
      },
    ];
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Export ----------

export function createMiniMaxProvider(): IQuotaProvider {
  return {
    id: "minimax",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await getApiKey();
      if (!apiKey) {
        logger.debug("[minimax] No API key (set MINIMAX_API_KEY or ~/.config/opencode/minimax-config.json)");
        return [];
      }
      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[minimax] fetch failed: ${message}`);
        return [{
          id: "minimax-status",
          providerName: "MiniMax",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
