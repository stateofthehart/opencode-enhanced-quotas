import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import {
  formatDuration,
  parseDurationToMs,
  readApiKey,
  toNumber,
} from "./provider-utils.js";

const TOGETHER_MODELS_ENDPOINT = "https://api.together.xyz/v1/models";
const TOGETHER_CHAT_ENDPOINT = "https://api.together.xyz/v1/chat/completions";

function parseHeaderQuota(headers: Headers, kind: "requests" | "tokens"): QuotaData | null {
  const limit =
    toNumber(headers.get(`x-ratelimit-limit-${kind}`)) ??
    toNumber(headers.get(`x-ratelimit-limit-${kind}-minute`)) ??
    toNumber(headers.get("x-ratelimit-limit"));
  const remaining =
    toNumber(headers.get(`x-ratelimit-remaining-${kind}`)) ??
    toNumber(headers.get(`x-ratelimit-remaining-${kind}-minute`)) ??
    toNumber(headers.get("x-ratelimit-remaining"));

  if (limit === null || remaining === null || limit <= 0) return null;

  const resetRaw =
    headers.get(`x-ratelimit-reset-${kind}`) ??
    headers.get(`x-ratelimit-reset-${kind}-minute`) ??
    headers.get("x-ratelimit-reset") ??
    headers.get("retry-after");
  const resetMs = parseDurationToMs(resetRaw);

  return {
    id: `together-${kind}`,
    providerName: `Together ${kind === "requests" ? "Requests" : "Tokens"}`,
    used: Math.max(0, Math.min(limit, limit - remaining)),
    limit,
    unit: kind,
    reset: resetMs !== null ? formatDuration(resetMs) : undefined,
    info: "from rate-limit headers",
  };
}

function pickModel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const models = Array.isArray(root) ? root : Array.isArray(root.data) ? root.data : [];
  const ids = models
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const preferred = ids.find((id) => /instruct|chat|llama|qwen|gemma|mixtral/i.test(id));
  return preferred ?? ids[0] ?? null;
}

async function fetchQuota(apiKey: string): Promise<QuotaData[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(TOGETHER_MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`Together models API ${res.status}: ${await res.text()}`);
    }

    const body = await res.json().catch(() => null);

    const directReq = parseHeaderQuota(res.headers, "requests");
    const directTok = parseHeaderQuota(res.headers, "tokens");
    const direct = [directReq, directTok].filter(Boolean) as QuotaData[];
    if (direct.length > 0) return direct;

    const model = pickModel(body);
    if (model) {
      const probe = await fetch(TOGETHER_CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "reply with one word: ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: ctrl.signal,
      });

      const probeReq = parseHeaderQuota(probe.headers, "requests");
      const probeTok = parseHeaderQuota(probe.headers, "tokens");
      const probeRows = [probeReq, probeTok].filter(Boolean) as QuotaData[];
      if (probeRows.length > 0) {
        return probeRows.map((q) => ({ ...q, info: "from one-word probe headers" }));
      }
    }

    return [{
      id: "together-status",
      providerName: "Together",
      used: 0,
      limit: null,
      unit: "status",
      info: "connected (no rate-limit headers)",
    }];
  } finally {
    clearTimeout(timeout);
  }
}

export function createTogetherProvider(): IQuotaProvider {
  return {
    id: "together",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["TOGETHER_API_KEY", "TOGETHER_KEY"],
        ["together-auth.json", "together.json", "together-config.json"],
        ["apiKey", "api_key", "apiToken", "token", "TOGETHER_API_KEY", "key"],
        ["together"],
      );
      if (!apiKey) return [];

      try {
        return await fetchQuota(apiKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[together] fetch failed: ${message}`);
        return [{
          id: "together-status",
          providerName: "Together",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
