import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import { formatDuration, readApiKey, toNumber } from "./provider-utils.js";

const HF_WHOAMI_ENDPOINT = "https://huggingface.co/api/whoami-v2";

function parseRateLimit(headers: Headers): QuotaData | null {
  const rateLimitRaw = headers.get("ratelimit") ?? headers.get("RateLimit");
  if (!rateLimitRaw) return null;

  const remainingMatch = rateLimitRaw.match(/(?:^|[;,\s])r=(\d+)/i);
  const resetMatch = rateLimitRaw.match(/(?:^|[;,\s])t=(\d+)/i);
  const remaining = remainingMatch ? Number.parseFloat(remainingMatch[1]) : null;
  const resetSeconds = resetMatch ? Number.parseFloat(resetMatch[1]) : null;
  if (remaining === null || !Number.isFinite(remaining)) return null;

  const policy = headers.get("ratelimit-policy") ?? headers.get("RateLimit-Policy");
  const limitMatch = policy?.match(/(?:^|[;,\s])q=(\d+)/i);
  const limit = limitMatch ? Number.parseFloat(limitMatch[1]) : null;

  return {
    id: "huggingface-api",
    providerName: "Hugging Face API",
    used: limit !== null && Number.isFinite(limit) ? Math.max(0, Math.min(limit, limit - remaining)) : 0,
    limit: limit !== null && Number.isFinite(limit) ? limit : null,
    unit: "requests",
    reset: resetSeconds !== null && Number.isFinite(resetSeconds) ? formatDuration(resetSeconds * 1000) : undefined,
    info: "from RateLimit headers",
  };
}

function parseXRateLimit(headers: Headers): QuotaData | null {
  const limit = toNumber(headers.get("x-ratelimit-limit"));
  const remaining = toNumber(headers.get("x-ratelimit-remaining"));
  if (limit === null || remaining === null || limit <= 0) return null;

  return {
    id: "huggingface-xratelimit",
    providerName: "Hugging Face API",
    used: Math.max(0, Math.min(limit, limit - remaining)),
    limit,
    unit: "requests",
    info: "from x-ratelimit headers",
  };
}

async function fetchQuota(apiKey: string): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(HF_WHOAMI_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`Hugging Face whoami API ${res.status}: ${await res.text()}`);
    }

    const entries: QuotaData[] = [];
    const parsedRateLimit = parseRateLimit(res.headers);
    const parsedXRateLimit = parseXRateLimit(res.headers);
    if (parsedRateLimit) entries.push(parsedRateLimit);
    if (parsedXRateLimit) entries.push(parsedXRateLimit);

    if (entries.length > 0) return entries;

    return [
      {
        id: "huggingface-status",
        providerName: "Hugging Face",
        used: 0,
        limit: null,
        unit: "status",
        info: "connected (quota headers unavailable)",
      },
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export function createHuggingFaceProvider(): IQuotaProvider {
  return {
    id: "huggingface",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["HUGGINGFACE_API_KEY", "HF_TOKEN", "HUGGINGFACEHUB_API_TOKEN", "HF_API_TOKEN"],
        ["huggingface-auth.json", "huggingface.json", "hf-auth.json", "hf.json"],
        ["apiKey", "api_key", "token", "accessToken", "hfToken", "huggingfaceToken", "HF_TOKEN", "key"],
        ["huggingface", "hf", "huggingfacehub"],
      );
      if (!apiKey) {
        logger.debug("[huggingface] No API key (HUGGINGFACE_API_KEY/HF_TOKEN or ~/.config/opencode/huggingface-auth.json)");
        return [];
      }

      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[huggingface] fetch failed: ${message}`);
        return [{
          id: "huggingface-status",
          providerName: "Hugging Face",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
