import type { IQuotaProvider, QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";
import {
  formatDuration,
  parseDurationToMs,
  readApiKey,
  toNumber,
} from "./provider-utils.js";

const DEEPINFRA_MODELS_ENDPOINT = "https://api.deepinfra.com/v1/openai/models";
const DEEPINFRA_CHAT_ENDPOINT = "https://api.deepinfra.com/v1/openai/chat/completions";

function parseHeaderQuota(headers: Headers, kind: "requests" | "tokens"): QuotaData | null {
  const limit =
    toNumber(headers.get(`x-ratelimit-limit-${kind}`)) ??
    toNumber(headers.get("x-ratelimit-limit"));
  const remaining =
    toNumber(headers.get(`x-ratelimit-remaining-${kind}`)) ??
    toNumber(headers.get("x-ratelimit-remaining"));

  if (limit === null || remaining === null || limit <= 0) return null;

  const resetRaw =
    headers.get(`x-ratelimit-reset-${kind}`) ??
    headers.get("x-ratelimit-reset") ??
    headers.get("retry-after");
  const resetMs = parseDurationToMs(resetRaw);

  return {
    id: `deepinfra-${kind}`,
    providerName: `DeepInfra ${kind === "requests" ? "Requests" : "Tokens"}`,
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
  const models = Array.isArray(root.data) ? root.data : [];
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
    const res = await fetch(DEEPINFRA_MODELS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`DeepInfra models API ${res.status}: ${await res.text()}`);
    }

    const body = await res.json().catch(() => null);
    const directReq = parseHeaderQuota(res.headers, "requests");
    const directTok = parseHeaderQuota(res.headers, "tokens");
    const direct = [directReq, directTok].filter(Boolean) as QuotaData[];
    if (direct.length > 0) return direct;

    const model = pickModel(body);
    if (model) {
      const probe = await fetch(DEEPINFRA_CHAT_ENDPOINT, {
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
      id: "deepinfra-status",
      providerName: "DeepInfra",
      used: 0,
      limit: null,
      unit: "status",
      info: "connected (no rate-limit headers)",
    }];
  } finally {
    clearTimeout(timeout);
  }
}

export function createDeepInfraProvider(): IQuotaProvider {
  return {
    id: "deepinfra",
    async fetchQuota(): Promise<QuotaData[]> {
      const apiKey = await readApiKey(
        ["DEEPINFRA_API_KEY", "DEEPINFRA_TOKEN"],
        ["deepinfra-auth.json", "deepinfra.json", "deepinfra-config.json"],
        ["apiKey", "api_key", "apiToken", "token", "DEEPINFRA_API_KEY", "key"],
        ["deepinfra"],
      );
      if (!apiKey) return [];

      try {
        return await fetchQuota(apiKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[deepinfra] fetch failed: ${message}`);
        return [{
          id: "deepinfra-status",
          providerName: "DeepInfra",
          used: 0,
          limit: null,
          unit: "status",
          info: "auth detected; request failed",
        }];
      }
    },
  };
}
