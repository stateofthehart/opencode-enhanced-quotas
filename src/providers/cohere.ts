import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import {
  formatDuration,
  parseDurationToMs,
  readApiKey,
  toNumber,
} from "./provider-utils.js";

const COHERE_MODELS_ENDPOINT = "https://api.cohere.ai/v1/models";
const COHERE_CHAT_ENDPOINT = "https://api.cohere.ai/v2/chat";

function parseHeaderQuota(
  headers: Headers,
  kind: "requests" | "tokens",
): QuotaData | null {
  const limit =
    toNumber(headers.get(`x-ratelimit-limit-${kind}`)) ??
    toNumber(headers.get(`x-ratelimit-limit`));
  const remaining =
    toNumber(headers.get(`x-ratelimit-remaining-${kind}`)) ??
    toNumber(headers.get(`x-ratelimit-remaining`));

  if (limit === null || remaining === null || limit <= 0) return null;

  const resetRaw =
    headers.get(`x-ratelimit-reset-${kind}`) ??
    headers.get(`x-ratelimit-reset`);
  const resetMs = parseDurationToMs(resetRaw);

  return {
    id: `cohere-${kind}`,
    providerName: `Cohere ${kind === "requests" ? "Requests" : "Tokens"}`,
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
    const res = await fetch(COHERE_MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`Cohere models API ${res.status}: ${await res.text()}`);
    }

    const entries: QuotaData[] = [];
    const requestQuota = parseHeaderQuota(res.headers, "requests");
    const tokenQuota = parseHeaderQuota(res.headers, "tokens");
    if (requestQuota) entries.push(requestQuota);
    if (tokenQuota) entries.push(tokenQuota);

    if (entries.length > 0) return entries;

    const probeRes = await fetch(COHERE_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "command-r",
        messages: [{ role: "user", content: "reply with one word: ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: ctrl.signal,
    });

    const probeReq = parseHeaderQuota(probeRes.headers, "requests");
    const probeTok = parseHeaderQuota(probeRes.headers, "tokens");
    const probeEntries = [probeReq, probeTok].filter(Boolean) as QuotaData[];
    if (probeEntries.length > 0) {
      return probeEntries.map((row) => ({
        ...row,
        info: "from one-word probe headers",
      }));
    }

    if (probeRes.ok) {
      return [
        {
          id: "cohere-status",
          providerName: "Cohere",
          used: 0,
          limit: null,
          unit: "status",
          info: "connected (trial key - rate limits apply)",
        },
      ];
    }

    return [
      {
        id: "cohere-status",
        providerName: "Cohere",
        used: 0,
        limit: null,
        unit: "status",
        info: "connected (no rate-limit headers)",
      },
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export function createCohereProvider(): IQuotaProvider {
  return {
    id: "cohere",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["COHERE_API_KEY", "COHERE_KEY"],
        ["cohere-auth.json", "cohere.json", "cohere-config.json"],
        ["apiKey", "api_key", "apiToken", "token", "cohereApiKey", "COHERE_API_KEY", "key"],
        ["cohere"],
      );
      if (!apiKey) {
        logger.debug("[cohere] No API key (COHERE_API_KEY or ~/.config/opencode/cohere-auth.json)");
        return [];
      }

      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[cohere] fetch failed: ${message}`);
        return [{
          id: "cohere-status",
          providerName: "Cohere",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}