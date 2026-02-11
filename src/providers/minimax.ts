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

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { QuotaData, IQuotaProvider } from "../interfaces.js";
import { logger } from "../logger.js";

// ---------- Auth ----------

async function getApiKey(): Promise<string | null> {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;

  try {
    const configPath = join(homedir(), ".config", "opencode", "minimax-config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    if (config.apiKey) return config.apiKey;
  } catch {
    // no config
  }

  return null;
}

function getEndpoint(): string {
  if (process.env.MINIMAX_REMAINS_URL) return process.env.MINIMAX_REMAINS_URL;
  const host = process.env.MINIMAX_HOST || "https://api.minimax.io";
  return `${host}/v1/coding_plan/remains`;
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
    const res = await fetch(getEndpoint(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`MiniMax API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as MiniMaxResponse;
    
    // Check for error response (e.g., not coding plan token)
    if (data.base_resp && data.base_resp.status_code !== 0) {
      return [{
        id: "minimax-status",
        providerName: "MiniMax",
        used: 0,
        limit: null,
        unit: "status",
        info: data.base_resp.status_msg,
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
        logger.debug(`[minimax] fetch failed: ${err instanceof Error ? err.message : err}`);
        return [];
      }
    },
  };
}
