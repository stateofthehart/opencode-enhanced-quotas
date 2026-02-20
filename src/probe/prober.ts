import {
  ProbeResult,
  ProbeConfig,
  QuotaError,
  QuotaErrorType,
  IProber,
  ProviderCapability,
} from "../interfaces.js";
import { toNumber, parseDurationToMs, readApiKey, readProviderConfig, readOpenCodeAuthField } from "../providers/provider-utils.js";

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_PROMPT = "Reply with exactly one word: ok";
const DEFAULT_MAX_TOKENS = 5;

export const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    id: "groq",
    name: "Groq",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "llama-3.1-8b-instant",
    probeEndpoint: "https://api.groq.com/openai/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "per_model",
    notes: "True free tier. Rate limits: 30 RPM, 6K TPM per model.",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "llama-3.3-70b",
    probeEndpoint: "https://api.cerebras.ai/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "per_model",
    notes: "Free tier with rate limits. $10 deposit unlocks higher limits.",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    probeEndpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: 1,
    rateLimitType: "provider_wide",
    notes: "$1 free credits on signup. Some models require credits.",
  },
  {
    id: "together",
    name: "Together",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "meta-llama/Llama-3.2-3B-Instruct-Turbo",
    probeEndpoint: "https://api.together.xyz/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: true,
    isSubscription: false,
    minimumDeposit: 1,
    freeCredits: 1,
    rateLimitType: "per_model",
    notes: "$1 minimum deposit required. Free credits on signup.",
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "meta-llama/Llama-2-7b-chat-hf",
    probeEndpoint: "https://api.deepinfra.com/v1/openai/chat/completions",
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: true,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "per_model",
    notes: "Pay-as-you-go. Some free models available.",
  },
  {
    id: "mistral",
    name: "Mistral",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "mistral-tiny",
    probeEndpoint: "https://api.mistral.ai/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "provider_wide",
    notes: "Free tier: 1K requests/month. Paid plans for higher limits.",
  },
  {
    id: "cohere",
    name: "Cohere",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "command-light",
    probeEndpoint: "https://api.cohere.ai/compatibility/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "provider_wide",
    notes: "Free trial tier available. Rate limits apply.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    telemetryType: "authoritative",
    supportsProbe: true,
    probeModel: "meta-llama/llama-3.1-8b-instruct:free",
    probeEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: true,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "provider_model_specific",
    notes: "Free models (:free suffix) available. 20 RPM for free tier. Credits unlock all models.",
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "meta/llama-3.1-8b-instruct",
    probeEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "provider_wide",
    notes: "Free tier with rate limits. Build API access.",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    telemetryType: "header-based",
    supportsProbe: true,
    probeModel: "meta-llama/Llama-3.2-1B-Instruct",
    probeEndpoint: "https://router.huggingface.co/meta-llama/Llama-3.2-1B-Instruct",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "provider_wide",
    notes: "Free inference API with rate limits. Pro plans available.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    telemetryType: "status-only",
    supportsProbe: true,
    probeModel: "@cf/meta/llama-3.1-8b-instruct",
    probeEndpoint: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct",
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: true,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: "provider_wide",
    notes: "Free tier: 10K requests/day. Requires accountId + apiToken.",
  },
  {
    id: "anthropic",
    name: "Claude (Anthropic)",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: false,
    isSubscription: true,
    minimumDeposit: undefined,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Subscription required. Use via OpenCode auth.",
  },
  {
    id: "codex",
    name: "Codex (OpenAI)",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: false,
    isSubscription: true,
    minimumDeposit: undefined,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Subscription required. Use via OpenCode auth.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: false,
    isSubscription: true,
    minimumDeposit: undefined,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Subscription required. Use via OpenCode auth.",
  },
  {
    id: "cursor",
    name: "Cursor",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: false,
    isSubscription: true,
    minimumDeposit: undefined,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Subscription required. Use via OpenCode auth.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Free tier via Google AI Studio. Use via OpenCode auth.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Free tier. Use via OpenCode auth.",
  },
  {
    id: "zai",
    name: "z.ai",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: true,
    isPayAsYouGo: false,
    isSubscription: false,
    minimumDeposit: 0,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Free tier available. Use via OpenCode auth.",
  },
  {
    id: "minimax",
    name: "MiniMax",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: true,
    isSubscription: false,
    minimumDeposit: undefined,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Pay-as-you-go. Coding plan required for API access.",
  },
  {
    id: "jetbrains",
    name: "JetBrains AI",
    telemetryType: "authoritative",
    supportsProbe: false,
    requiresAuth: true,
    isFreeTier: false,
    isPayAsYouGo: false,
    isSubscription: true,
    minimumDeposit: undefined,
    freeCredits: undefined,
    rateLimitType: undefined,
    notes: "Subscription required. Use via OpenCode auth.",
  },
];

function classifyError(status: number, body: string, headers: Headers): QuotaError {
  const retryAfter = headers.get("retry-after");
  const retryAfterMs = retryAfter ? parseDurationToMs(retryAfter) : null;

  if (status === 429) {
    return {
      type: "rate_limited",
      provider: "unknown",
      retryAfter: retryAfterMs || undefined,
      resetAt: retryAfterMs ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }

  if (status === 401 || status === 403) {
    const bodyLower = body.toLowerCase();
    if (bodyLower.includes("invalid") || bodyLower.includes("expired")) {
      return { type: "auth_expired", provider: "unknown" };
    }
    if (bodyLower.includes("billing") || bodyLower.includes("payment")) {
      return { type: "billing", provider: "unknown" };
    }
    return { type: "auth_invalid", provider: "unknown" };
  }

  if (status === 402 || status === 403) {
    const bodyLower = body.toLowerCase();
    if (bodyLower.includes("credit") || bodyLower.includes("balance") || bodyLower.includes("fund")) {
      return { type: "no_credits", provider: "unknown", fundBalance: 0 };
    }
    if (bodyLower.includes("billing") || bodyLower.includes("payment")) {
      return { type: "billing", provider: "unknown" };
    }
  }

  if (status === 404) {
    return { type: "model_unavailable", provider: "unknown" };
  }

  if (status >= 500) {
    return { type: "endpoint_down", provider: "unknown", lastSeen: new Date() };
  }

  const bodyLower = body.toLowerCase();
  if (bodyLower.includes("rate limit") || bodyLower.includes("too many requests")) {
    return { type: "rate_limited", provider: "unknown" };
  }
  if (bodyLower.includes("insufficient") || bodyLower.includes("no credit") || bodyLower.includes("balance")) {
    return { type: "no_credits", provider: "unknown" };
  }

  return { type: "unknown", provider: "unknown", message: body.slice(0, 200) };
}

function parseRateLimitHeaders(headers: Headers): {
  remaining?: number;
  limit?: number;
  reset?: Date;
} {
  const result: { remaining?: number; limit?: number; reset?: Date } = {};

  const remainingKeys = [
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining",
    "ratelimit-remaining",
    "x-rate-limit-remaining",
  ];
  for (const key of remainingKeys) {
    const val = toNumber(headers.get(key));
    if (val !== null) {
      result.remaining = val;
      break;
    }
  }

  const limitKeys = [
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit",
    "ratelimit-limit",
    "x-rate-limit-limit",
  ];
  for (const key of limitKeys) {
    const val = toNumber(headers.get(key));
    if (val !== null) {
      result.limit = val;
      break;
    }
  }

  const resetKeys = [
    "x-ratelimit-reset",
    "ratelimit-reset",
    "x-rate-limit-reset",
  ];
  for (const key of resetKeys) {
    const val = headers.get(key);
    if (val) {
      const ms = parseDurationToMs(val);
      if (ms) {
        result.reset = new Date(Date.now() + ms);
        break;
      }
    }
  }

  return result;
}

async function getApiKey(provider: string): Promise<string | null> {
  const envKeyMap: Record<string, string[]> = {
    groq: ["GROQ_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
    fireworks: ["FIREWORKS_API_KEY", "FIREWORKS_AI_API_KEY"],
    together: ["TOGETHER_API_KEY"],
    deepinfra: ["DEEPINFRA_API_KEY"],
    mistral: ["MISTRAL_API_KEY"],
    cohere: ["COHERE_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    "nvidia-nim": ["NVIDIA_NIM_API_KEY", "NVIDIA_API_KEY"],
    huggingface: ["HF_API_KEY", "HUGGINGFACE_API_KEY"],
    cloudflare: ["CLOUDFLARE_WORKERS_AI_API_KEY", "CLOUDFLARE_API_KEY"],
  };

  const configFileMap: Record<string, string[]> = {
    groq: ["groq-auth.json"],
    cerebras: ["cerebras-auth.json"],
    fireworks: ["fireworks-auth.json"],
    together: ["together-auth.json"],
    deepinfra: ["deepinfra-auth.json"],
    mistral: ["mistral-auth.json"],
    cohere: ["cohere-auth.json"],
    openrouter: ["openrouter-auth.json"],
    "nvidia-nim": ["nvidia-auth.json", "nim-auth.json"],
    huggingface: ["huggingface-auth.json", "hf-auth.json"],
    cloudflare: ["cloudflare-auth.json"],
  };

  const openCodeProviderMap: Record<string, string[]> = {
    groq: ["groq"],
    cerebras: ["cerebras"],
    fireworks: ["fireworks-ai", "fireworks"],
    together: ["together"],
    deepinfra: ["deepinfra"],
    mistral: ["mistral"],
    cohere: ["cohere"],
    openrouter: ["openrouter"],
    "nvidia-nim": ["nvidia", "nim"],
    huggingface: ["huggingface", "hf"],
    cloudflare: ["cloudflare", "cloudflare-workers-ai"],
  };

  const envKeys = envKeyMap[provider] || [];
  const configFiles = configFileMap[provider] || [];
  const openCodeAliases = openCodeProviderMap[provider] || [];

  return readApiKey(envKeys, configFiles, ["apiKey", "apiToken", "api_key", "key"], openCodeAliases);
}

async function getCloudflareAccountId(): Promise<string | null> {
  try {
    // First check cloudflare-auth.json
    const configData = await readProviderConfig("cloudflare-auth.json");
    if (configData && typeof configData === "object") {
      const config = configData as Record<string, unknown>;
      if (config.accountId && typeof config.accountId === "string") {
        return config.accountId;
      }
    }
    
    // Also check OpenCode auth.json for cloudflare-workers-ai accountId
    const accountIdFromOpenCode = await readOpenCodeAuthField(
      ["cloudflare-workers-ai"],
      ["accountId", "account_id", "account"]
    );
    if (accountIdFromOpenCode) {
      return accountIdFromOpenCode as string;
    }
  } catch {}
  return null;
}

async function probeOpenAICompatible(
  endpoint: string,
  model: string,
  apiKey: string,
  config: ProbeConfig
): Promise<{ status: number; headers: Headers; body: string; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout || DEFAULT_TIMEOUT);

  const startTime = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: config.prompt || DEFAULT_PROMPT }],
        max_tokens: config.maxTokens || DEFAULT_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;
    const body = await response.text();

    return {
      status: response.status,
      headers: response.headers,
      body,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeCohere(
  apiKey: string,
  config: ProbeConfig
): Promise<{ status: number; headers: Headers; body: string; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout || DEFAULT_TIMEOUT);

  const startTime = Date.now();
  try {
    const response = await fetch("https://api.cohere.ai/v2/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "command-light",
        messages: [{ role: "user", content: config.prompt || DEFAULT_PROMPT }],
        max_tokens: config.maxTokens || DEFAULT_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;
    const body = await response.text();

    return {
      status: response.status,
      headers: response.headers,
      body,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeHuggingFace(
  apiKey: string,
  model: string,
  config: ProbeConfig
): Promise<{ status: number; headers: Headers; body: string; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout || DEFAULT_TIMEOUT);

  const startTime = Date.now();
  try {
    const endpoint = `https://router.huggingface.co/${model}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: config.prompt || DEFAULT_PROMPT,
        parameters: {
          max_new_tokens: config.maxTokens || DEFAULT_MAX_TOKENS,
        },
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;
    const body = await response.text();

    return {
      status: response.status,
      headers: response.headers,
      body,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeCloudflare(
  apiKey: string,
  accountId: string,
  model: string,
  config: ProbeConfig
): Promise<{ status: number; headers: Headers; body: string; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout || DEFAULT_TIMEOUT);

  const startTime = Date.now();
  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: config.prompt || DEFAULT_PROMPT }],
        max_tokens: config.maxTokens || DEFAULT_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;
    const body = await response.text();

    return {
      status: response.status,
      headers: response.headers,
      body,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export class Prober implements IProber {
  async probe(provider: string, model?: string, config: ProbeConfig = {}): Promise<ProbeResult> {
    const capability = PROVIDER_CAPABILITIES.find((c) => c.id === provider);
    if (!capability) {
      return {
        provider,
        model: model || "unknown",
        available: false,
        latencyMs: 0,
        error: {
          type: "unknown",
          provider,
          message: `Unknown provider: ${provider}`,
        },
        timestamp: new Date(),
      };
    }

    if (!capability.supportsProbe) {
      return {
        provider,
        model: model || capability.probeModel || "unknown",
        available: false,
        latencyMs: 0,
        error: {
          type: "unknown",
          provider,
          message: `Provider does not support probing: ${provider}`,
        },
        timestamp: new Date(),
      };
    }

    const apiKey = await getApiKey(provider);
    if (!apiKey && capability.requiresAuth) {
      return {
        provider,
        model: model || capability.probeModel || "unknown",
        available: false,
        latencyMs: 0,
        error: {
          type: "auth_invalid",
          provider,
          message: "API key not found",
        },
        timestamp: new Date(),
      };
    }

    const targetModel = model || capability.probeModel || "unknown";
    const startTime = Date.now();

    try {
      let result: { status: number; headers: Headers; body: string; latencyMs: number };

      if (provider === "cohere") {
        result = await probeCohere(apiKey!, config);
      } else if (provider === "huggingface") {
        result = await probeHuggingFace(apiKey!, targetModel, config);
      } else if (provider === "cloudflare") {
        const accountId = await getCloudflareAccountId();
        if (!accountId) {
          return {
            provider,
            model: targetModel,
            available: false,
            latencyMs: 0,
            error: {
              type: "auth_invalid",
              provider,
              message: "Cloudflare accountId not found in config",
            },
            timestamp: new Date(),
          };
        }
        result = await probeCloudflare(apiKey!, accountId, targetModel, config);
      } else {
        result = await probeOpenAICompatible(
          capability.probeEndpoint!,
          targetModel,
          apiKey!,
          config
        );
      }

      const rateLimitInfo = parseRateLimitHeaders(result.headers);
      const headersObj: Record<string, string> = {};
      result.headers.forEach((v, k) => {
        headersObj[k] = v;
      });

      // Special handling for Cohere - trial key responses are successful but contain info messages
      if (result.status >= 200 && result.status < 300) {
        return {
          provider,
          model: targetModel,
          available: true,
          latencyMs: result.latencyMs,
          rateLimitRemaining: rateLimitInfo.remaining,
          rateLimitLimit: rateLimitInfo.limit,
          rateLimitReset: rateLimitInfo.reset,
          timestamp: new Date(),
          headers: headersObj,
        };
      }

      // Special handling for Cohere trial key rate limiting
      if (provider === "cohere" && result.status === 429) {
        // Check if this is a trial key limit (not account limit)
        const bodyObj = JSON.parse(result.body || "{}");
        if (bodyObj.message && bodyObj.message.includes("Trial key")) {
          // This is a trial key rate limit, not an error - treat as available but rate limited
          return {
            provider,
            model: targetModel,
            available: true,
            latencyMs: result.latencyMs,
            rateLimitRemaining: 0,
            rateLimitLimit: rateLimitInfo.limit,
            rateLimitReset: rateLimitInfo.reset,
            timestamp: new Date(),
            headers: headersObj,
          };
        }
      }

      const error = classifyError(result.status, result.body, result.headers);
      error.provider = provider;

      return {
        provider,
        model: targetModel,
        available: false,
        latencyMs: result.latencyMs,
        error,
        timestamp: new Date(),
        headers: headersObj,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        provider,
        model: targetModel,
        available: false,
        latencyMs,
        error: {
          type: "endpoint_down",
          provider,
          message: errorMessage,
          lastSeen: new Date(),
        },
        timestamp: new Date(),
      };
    }
  }

  async probeAll(config: ProbeConfig = {}): Promise<ProbeResult[]> {
    const probeable = PROVIDER_CAPABILITIES.filter((c) => c.supportsProbe);
    const results = await Promise.all(probeable.map((c) => this.probe(c.id, c.probeModel, config)));
    return results;
  }

  async probeAllModels(config: ProbeConfig = {}): Promise<ProbeResult[]> {
    const { getModelDiscovery } = await import("../discovery/index.js");
    const discovery = getModelDiscovery(async (providerId: string) => {
      return getApiKey(providerId);
    });
    const results: ProbeResult[] = [];

    const probeable = PROVIDER_CAPABILITIES.filter((c) => c.supportsProbe);

    for (const cap of probeable) {
      try {
        const modelInfo = await discovery.discoverModels(cap.id);
        const models = modelInfo.models.filter((m) => m.isFree);

        if (models.length === 0) {
          results.push({
            provider: cap.id,
            model: cap.probeModel || "unknown",
            available: false,
            latencyMs: 0,
            error: {
              type: "model_unavailable",
              provider: cap.id,
              message: "No free models available",
            },
            timestamp: new Date(),
          });
          continue;
        }

        const probeLimit = config.maxModelsPerProvider || 5;
        const modelsToProbe = models.slice(0, probeLimit);

        for (const model of modelsToProbe) {
          const result = await this.probe(cap.id, model.id, config);
          results.push(result);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        results.push({
          provider: cap.id,
          model: cap.probeModel || "unknown",
          available: false,
          latencyMs: 0,
          error: {
            type: "unknown",
            provider: cap.id,
            message: `Discovery failed: ${errorMessage}`,
          },
          timestamp: new Date(),
        });
      }
    }

    return results;
  }
}

export function createProber(): IProber {
  return new Prober();
}

export function getProber(): IProber {
  return new Prober();
}

export { getApiKey };
