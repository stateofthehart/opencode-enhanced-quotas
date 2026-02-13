import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import {
  formatDuration,
  parseDurationToMs,
  readApiKey,
  toNumber,
} from "./provider-utils.js";

const NIM_MODELS_ENDPOINT = "https://integrate.api.nvidia.com/v1/models";

function parseHeaderQuota(headers: Headers, kind: "requests" | "tokens"): QuotaData | null {
  const limit =
    toNumber(headers.get(`x-ratelimit-limit-${kind}`)) ??
    toNumber(headers.get(`x-ratelimit-limit-${kind}-minute`));
  const remaining =
    toNumber(headers.get(`x-ratelimit-remaining-${kind}`)) ??
    toNumber(headers.get(`x-ratelimit-remaining-${kind}-minute`));

  if (limit === null || remaining === null || limit <= 0) return null;

  const resetRaw =
    headers.get(`x-ratelimit-reset-${kind}`) ??
    headers.get(`x-ratelimit-reset-${kind}-minute`) ??
    headers.get("retry-after");
  const resetMs = parseDurationToMs(resetRaw);

  return {
    id: `nim-${kind}`,
    providerName: `NVIDIA NIM ${kind === "requests" ? "Requests" : "Tokens"}`,
    used: Math.max(0, Math.min(limit, limit - remaining)),
    limit,
    unit: kind,
    reset: resetMs !== null ? formatDuration(resetMs) : undefined,
    info: "from rate-limit headers",
  };
}

async function fetchQuota(apiKey: string): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(NIM_MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`NVIDIA NIM models API ${res.status}: ${await res.text()}`);
    }

    const entries: QuotaData[] = [];
    const requestQuota = parseHeaderQuota(res.headers, "requests");
    const tokenQuota = parseHeaderQuota(res.headers, "tokens");
    if (requestQuota) entries.push(requestQuota);
    if (tokenQuota) entries.push(tokenQuota);

    if (entries.length > 0) return entries;

    return [
      {
        id: "nim-requests",
        providerName: "NVIDIA NIM Requests",
        used: 0,
        limit: null,
        unit: "requests",
        info: "connected (trial/shared pool limit undisclosed)",
      },
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export function createNvidiaNimProvider(): IQuotaProvider {
  return {
    id: "nvidia-nim",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["NVIDIA_NIM_API_KEY", "NGC_API_KEY", "NVIDIA_API_KEY", "NIM_API_KEY"],
        ["nvidia-nim-auth.json", "nim-auth.json", "nvidia-auth.json", "ngc-auth.json"],
        ["apiKey", "api_key", "apiToken", "token", "ngcApiKey", "NVIDIA_NIM_API_KEY", "NGC_API_KEY", "key"],
        ["nvidia", "nvidia-nim", "nim", "ngc"],
      );
      if (!apiKey) {
        logger.debug("[nvidia-nim] No API key (NVIDIA_NIM_API_KEY/NGC_API_KEY or ~/.config/opencode/nvidia-nim-auth.json)");
        return [];
      }

      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[nvidia-nim] fetch failed: ${message}`);
        return [{
          id: "nim-status",
          providerName: "NVIDIA NIM",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
