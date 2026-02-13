import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import {
  formatDuration,
  parseDurationToMs,
  readApiKey,
  toNumber,
} from "./provider-utils.js";

const CEREBRAS_MODELS_ENDPOINT = "https://api.cerebras.ai/v1/models";
const CEREBRAS_CHAT_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";

function selectProbeModel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const models = Array.isArray(root.data) ? root.data : [];
  const ids = models
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const preferred = ids.find((id) => /instruct|chat|llama|qwen|gpt-oss/i.test(id));
  return preferred ?? ids[0] ?? null;
}

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
    headers.get(`x-ratelimit-reset-${kind}-minute`);
  const resetMs = parseDurationToMs(resetRaw);

  return {
    id: `cerebras-${kind}`,
    providerName: `Cerebras ${kind === "requests" ? "Requests" : "Tokens"}`,
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
    const res = await fetch(CEREBRAS_MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`Cerebras models API ${res.status}: ${await res.text()}`);
    }

    const body = await res.json().catch(() => null);

    const entries: QuotaData[] = [];
    const requestQuota = parseHeaderQuota(res.headers, "requests");
    const tokenQuota = parseHeaderQuota(res.headers, "tokens");
    if (requestQuota) entries.push(requestQuota);
    if (tokenQuota) entries.push(tokenQuota);

    if (entries.length > 0) return entries;

    const model = selectProbeModel(body);
    if (model) {
      const probeRes = await fetch(CEREBRAS_CHAT_ENDPOINT, {
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

      const probeReq = parseHeaderQuota(probeRes.headers, "requests");
      const probeTok = parseHeaderQuota(probeRes.headers, "tokens");
      const probeEntries = [probeReq, probeTok].filter(Boolean) as QuotaData[];
      if (probeEntries.length > 0) {
        return probeEntries.map((row) => ({
          ...row,
          info: "from one-word probe headers",
        }));
      }
    }

    return [
      {
        id: "cerebras-status",
        providerName: "Cerebras",
        used: 0,
        limit: null,
        unit: "status",
        info: "connected (quota endpoint unavailable for shared tier)",
      },
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export function createCerebrasProvider(): IQuotaProvider {
  return {
    id: "cerebras",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["CEREBRAS_API_KEY", "CEREBRAS_KEY"],
        ["cerebras-auth.json", "cerebras.json", "cerebras-config.json"],
        ["apiKey", "api_key", "apiToken", "token", "cerebrasApiKey", "CEREBRAS_API_KEY", "key"],
        ["cerebras"],
      );
      if (!apiKey) {
        logger.debug("[cerebras] No API key (CEREBRAS_API_KEY or ~/.config/opencode/cerebras-auth.json)");
        return [];
      }

      try {
        return await fetchQuota(apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[cerebras] fetch failed: ${message}`);
        return [{
          id: "cerebras-status",
          providerName: "Cerebras",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
