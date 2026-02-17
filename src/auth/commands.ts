import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import type { QuotaData } from "../interfaces.js";
import {
  readOpenCodeAuthField,
  readStringFromConfigCandidates,
} from "../providers/provider-utils.js";
import { createOpenRouterProvider } from "../providers/openrouter.js";
import { createNvidiaNimProvider } from "../providers/nvidia-nim.js";
import { createCerebrasProvider } from "../providers/cerebras.js";
import { createFireworksProvider } from "../providers/fireworks.js";
import { createCloudflareWorkersAIProvider } from "../providers/cloudflare-workers-ai.js";
import { createHuggingFaceProvider } from "../providers/huggingface.js";
import { createGroqProvider } from "../providers/groq.js";
import { createZaiProvider } from "../providers/zai.js";
import { createMiniMaxProvider } from "../providers/minimax.js";
import { createAntigravityProvider } from "../providers/antigravity/provider.js";
import { createCodexProvider } from "../providers/codex.js";
import { createCopilotProvider } from "../providers/copilot.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createCursorProvider } from "../providers/cursor.js";
import { createGeminiProvider } from "../providers/gemini.js";
import { createTogetherProvider } from "../providers/together.js";
import { createDeepInfraProvider } from "../providers/deepinfra.js";
import { createMistralProvider } from "../providers/mistral.js";
import { createCohereProvider } from "../providers/cohere.js";

type Source = "opencode" | "env" | "config" | "missing";

type FieldSpec = {
  id: string;
  label: string;
  aliases: string[];
  env: string[];
  required: boolean;
  secret?: boolean;
};

type ProviderSpec = {
  id: string;
  name: string;
  openCodeAliases: string[];
  configFile: string;
  fields: FieldSpec[];
  setupMode?: "interactive" | "managed";
  telemetry: "authoritative" | "headers" | "status";
  guidance?: string;
};

type ResolvedField = {
  value: string | null;
  source: Source;
};

type DoctorOptions = {
  verbose?: boolean;
  probe?: boolean;
};

const LOGIN_PROVIDER_MAP: Record<string, { cmd: string; args: string[] }> = {
  antigravity: { cmd: "opencode", args: ["auth", "login"] },
  codex: { cmd: "opencode", args: ["auth", "login", "openai"] },
  copilot: { cmd: "opencode", args: ["auth", "login", "github-copilot"] },
  anthropic: { cmd: "opencode", args: ["auth", "login", "anthropic"] },
  cursor: { cmd: "node", args: ["dist/cli.js", "login", "cursor"] },
  gemini: { cmd: "gemini", args: ["auth", "login"] },
  openrouter: { cmd: "opencode", args: ["auth", "login", "openrouter"] },
  "nvidia-nim": { cmd: "opencode", args: ["auth", "login", "nvidia"] },
  cerebras: { cmd: "opencode", args: ["auth", "login", "cerebras"] },
  fireworks: { cmd: "opencode", args: ["auth", "login", "fireworks-ai"] },
  "cloudflare-workers-ai": { cmd: "opencode", args: ["auth", "login", "cloudflare-workers-ai"] },
  huggingface: { cmd: "opencode", args: ["auth", "login", "huggingface"] },
  groq: { cmd: "opencode", args: ["auth", "login", "groq"] },
  zai: { cmd: "opencode", args: ["auth", "login", "zai"] },
  minimax: { cmd: "opencode", args: ["auth", "login", "minimax"] },
  together: { cmd: "opencode", args: ["auth", "login", "together"] },
  deepinfra: { cmd: "opencode", args: ["auth", "login", "deepinfra"] },
  mistral: { cmd: "opencode", args: ["auth", "login", "mistral"] },
  cohere: { cmd: "opencode", args: ["auth", "login", "cohere"] },
};

const PROVIDERS: ProviderSpec[] = [
  {
    id: "antigravity",
    name: "Antigravity",
    openCodeAliases: [],
    configFile: "antigravity-accounts.json",
    fields: [],
    setupMode: "managed",
    telemetry: "authoritative",
    guidance: "Use `opencode auth login` (Google) to refresh Antigravity credentials stored in ~/.config/opencode/antigravity-accounts.json.",
  },
  {
    id: "codex",
    name: "Codex",
    openCodeAliases: [],
    configFile: "auth.json",
    fields: [],
    setupMode: "managed",
    telemetry: "authoritative",
    guidance: "Use `opencode auth login openai` (or opencode) to refresh Codex auth.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    openCodeAliases: [],
    configFile: "auth.json",
    fields: [],
    setupMode: "managed",
    telemetry: "authoritative",
    guidance: "Use `opencode auth login github-copilot` to refresh Copilot auth.",
  },
  {
    id: "anthropic",
    name: "Claude",
    openCodeAliases: [],
    configFile: "auth.json",
    fields: [],
    setupMode: "managed",
    telemetry: "authoritative",
    guidance: "Use `opencode auth login anthropic` and ensure Claude local creds are present.",
  },
  {
    id: "cursor",
    name: "Cursor",
    openCodeAliases: ["cursor"],
    configFile: "cursor-auth.json",
    fields: [
      {
        id: "session",
        label: "Cursor session",
        aliases: ["cookie", "token", "accessToken"],
        env: ["CURSOR_COOKIE"],
        required: false,
      },
    ],
    setupMode: "interactive",
    telemetry: "authoritative",
    guidance: "If missing, run `opencode-quotas login cursor` for browser-assisted setup.",
  },
  {
    id: "gemini",
    name: "Gemini",
    openCodeAliases: [],
    configFile: "gemini-auth.json",
    fields: [],
    setupMode: "managed",
    telemetry: "authoritative",
    guidance: "Run `gemini auth login` if Gemini token is stale (stored in ~/.gemini/oauth_creds.json).",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    openCodeAliases: ["openrouter"],
    configFile: "openrouter-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "OPENROUTER_API_KEY"],
        env: ["OPENROUTER_API_KEY", "OPENROUTER_KEY", "OR_API_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "authoritative",
    guidance: "Connected is expected; hard limits appear only when key endpoint returns limit fields.",
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    openCodeAliases: ["nvidia", "nvidia-nim", "nim", "ngc"],
    configFile: "nvidia-nim-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "NGC_API_KEY", "NVIDIA_NIM_API_KEY"],
        env: ["NVIDIA_NIM_API_KEY", "NGC_API_KEY", "NVIDIA_API_KEY", "NIM_API_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "NVIDIA often exposes rate/usage via account dashboards; API may not expose hard limits.",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    openCodeAliases: ["cerebras"],
    configFile: "cerebras-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "CEREBRAS_API_KEY"],
        env: ["CEREBRAS_API_KEY", "CEREBRAS_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Shared tiers may not expose concrete quota endpoints.",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    openCodeAliases: ["fireworks", "fireworks-ai"],
    configFile: "fireworks-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "FIREWORKS_API_KEY"],
        env: ["FIREWORKS_API_KEY", "FIREWORKS_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Fireworks headers are model/route dependent; some endpoints return status only.",
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    openCodeAliases: ["cloudflare", "cloudflare-workers-ai", "workers-ai"],
    configFile: "cloudflare-auth.json",
    fields: [
      {
        id: "apiToken",
        label: "API Token",
        aliases: ["apiToken", "api_token", "token", "accessToken", "access_token", "key", "CLOUDFLARE_API_TOKEN"],
        env: ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
        required: true,
        secret: true,
      },
      {
        id: "accountId",
        label: "Account ID",
        aliases: ["accountId", "account_id", "account", "id", "CLOUDFLARE_ACCOUNT_ID"],
        env: ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT"],
        required: false,
      },
    ],
    setupMode: "interactive",
    telemetry: "status",
    guidance: "Provide accountId for stronger checks (`CLOUDFLARE_ACCOUNT_ID`).",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    openCodeAliases: ["huggingface", "hf", "huggingfacehub"],
    configFile: "huggingface-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "token", "accessToken", "HF_TOKEN", "key"],
        env: ["HUGGINGFACE_API_KEY", "HF_TOKEN", "HUGGINGFACEHUB_API_TOKEN", "HF_API_TOKEN"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Quota headers depend on route and account tier.",
  },
  {
    id: "groq",
    name: "Groq",
    openCodeAliases: ["groq"],
    configFile: "groq-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "GROQ_API_KEY"],
        env: ["GROQ_API_KEY", "GROQ_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Groq rate-limit headers can be absent on low-cost probe endpoints.",
  },
  {
    id: "zai",
    name: "z.ai",
    openCodeAliases: ["zai", "z.ai", "bigmodel"],
    configFile: "zai-config.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "token", "key", "Z_AI_API_KEY"],
        env: ["Z_AI_API_KEY", "ZAI_API_KEY", "BIGMODEL_API_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "authoritative",
    guidance: "z.ai usage API responses vary by account scope.",
  },
  {
    id: "minimax",
    name: "MiniMax",
    openCodeAliases: ["minimax", "minimax.io", "minimaxio"],
    configFile: "minimax-config.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "token", "key", "MINIMAX_API_KEY"],
        env: ["MINIMAX_API_KEY", "MINIMAX_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "authoritative",
    guidance: "If auth exists but fails, refresh MiniMax key or region settings.",
  },
  {
    id: "together",
    name: "Together",
    openCodeAliases: ["together"],
    configFile: "together-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "TOGETHER_API_KEY"],
        env: ["TOGETHER_API_KEY", "TOGETHER_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Together rate-limit headers are endpoint and model dependent.",
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    openCodeAliases: ["deepinfra"],
    configFile: "deepinfra-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "DEEPINFRA_API_KEY"],
        env: ["DEEPINFRA_API_KEY", "DEEPINFRA_TOKEN"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "DeepInfra rate-limit headers are not guaranteed on all routes.",
  },
  {
    id: "mistral",
    name: "Mistral",
    openCodeAliases: ["mistral"],
    configFile: "mistral-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "MISTRAL_API_KEY"],
        env: ["MISTRAL_API_KEY", "MISTRAL_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Mistral free tier: 1 RPS, 500k tokens/min, 1B tokens/month. Check limits at https://admin.mistral.ai/plateforme/limits",
  },
  {
    id: "cohere",
    name: "Cohere",
    openCodeAliases: ["cohere"],
    configFile: "cohere-auth.json",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        aliases: ["apiKey", "api_key", "apiToken", "token", "key", "COHERE_API_KEY"],
        env: ["COHERE_API_KEY", "COHERE_KEY"],
        required: true,
        secret: true,
      },
    ],
    setupMode: "interactive",
    telemetry: "headers",
    guidance: "Cohere trial: 20 req/min, 1000 calls/month. Production: 500 req/min. Rate limits by model type.",
  },
];

const providerValidators: Record<string, () => Promise<QuotaData[]>> = {
  openrouter: async () => createOpenRouterProvider().fetchQuota(),
  "nvidia-nim": async () => createNvidiaNimProvider().fetchQuota(),
  cerebras: async () => createCerebrasProvider().fetchQuota(),
  fireworks: async () => createFireworksProvider().fetchQuota(),
  "cloudflare-workers-ai": async () => createCloudflareWorkersAIProvider().fetchQuota(),
  huggingface: async () => createHuggingFaceProvider().fetchQuota(),
  groq: async () => createGroqProvider().fetchQuota(),
  zai: async () => createZaiProvider().fetchQuota(),
  minimax: async () => createMiniMaxProvider().fetchQuota(),
  antigravity: async () => createAntigravityProvider().fetchQuota(),
  codex: async () => createCodexProvider().fetchQuota(),
  copilot: async () => createCopilotProvider().fetchQuota(),
  anthropic: async () => createAnthropicProvider().fetchQuota(),
  cursor: async () => createCursorProvider().fetchQuota(),
  gemini: async () => createGeminiProvider().fetchQuota(),
  together: async () => createTogetherProvider().fetchQuota(),
  deepinfra: async () => createDeepInfraProvider().fetchQuota(),
  mistral: async () => createMistralProvider().fetchQuota(),
  cohere: async () => createCohereProvider().fetchQuota(),
};

function maskSecret(value: string): string {
  if (value.length <= 8) return "*".repeat(Math.max(4, value.length));
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseProviderArg(raw: string | undefined): ProviderSpec | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  return PROVIDERS.find((p) => p.id === id || p.name.toLowerCase() === id) ?? null;
}

async function resolveField(spec: ProviderSpec, field: FieldSpec): Promise<ResolvedField> {
  const fromOpenCode = await readOpenCodeAuthField(spec.openCodeAliases, field.aliases);
  if (fromOpenCode) return { value: fromOpenCode, source: "opencode" };

  for (const envKey of field.env) {
    const value = process.env[envKey];
    if (value && value.trim()) return { value: value.trim(), source: "env" };
  }

  const fromConfig = await readStringFromConfigCandidates([spec.configFile], field.aliases);
  if (fromConfig) return { value: fromConfig, source: "config" };

  return { value: null, source: "missing" };
}

async function resolveAllFields(spec: ProviderSpec): Promise<Record<string, ResolvedField>> {
  const resolved: Record<string, ResolvedField> = {};
  for (const field of spec.fields) {
    resolved[field.id] = await resolveField(spec, field);
  }
  return resolved;
}

async function promptInput(promptText: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question(defaultValue ? `${promptText} [${defaultValue}]: ` : `${promptText}: `);
  rl.close();
  const trimmed = value.trim();
  return trimmed || (defaultValue ?? "");
}

async function promptHidden(promptText: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const rlAny = rl as any;
  rlAny.stdoutMuted = true;
  rlAny._writeToOutput = function _writeToOutput(stringToWrite: string) {
    if (rlAny.stdoutMuted) {
      process.stdout.write("*");
    } else {
      process.stdout.write(stringToWrite);
    }
  };

  const value = await rl.question(`${promptText}: `);
  process.stdout.write("\n");
  rl.close();
  return value.trim();
}

async function chooseProviderInteractively(): Promise<ProviderSpec | null> {
  console.log("\nSelect provider to configure:");
  PROVIDERS.forEach((provider, idx) => {
    console.log(`  ${idx + 1}) ${provider.name} (${provider.id})`);
  });

  const choice = await promptInput("Enter number");
  const index = Number.parseInt(choice, 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= PROVIDERS.length) {
    console.error("Invalid selection.");
    return null;
  }

  return PROVIDERS[index];
}

async function validateProvider(providerID: string): Promise<{ status: "ok" | "warn" | "error"; detail: string }> {
  const validator = providerValidators[providerID];
  if (!validator) return { status: "warn", detail: "no validator" };

  try {
    const rows = await validator();
    if (rows.length === 0) {
      return { status: "error", detail: "no auth or no data" };
    }

    const infoText = rows.map((row) => row.info ?? "").join(" | ").toLowerCase();
    if (infoText.includes("insufficient balance") || infoText.includes("billing") || infoText.includes("not coding plan token")) {
      return { status: "error", detail: `billing: ${rows[0]?.info ?? "insufficient balance"}` };
    }
    if (infoText.includes("request failed") || infoText.includes("invalid") || infoText.includes("unauthorized") || infoText.includes("invalid_grant")) {
      return { status: "error", detail: rows[0]?.info ?? "request failed" };
    }
    if (infoText.includes("set cloudflare_account_id") || infoText.includes("grant account-list permission")) {
      return { status: "warn", detail: rows[0]?.info ?? "missing account metadata" };
    }
    if (infoText.includes("operation successful")) {
      return { status: "warn", detail: "connected (provider responded without explicit quota metrics)" };
    }

    const hasConcreteQuota = rows.some((row) => row.limit !== null && row.unit !== "status");
    if (hasConcreteQuota) return { status: "ok", detail: "quota metrics available" };

    return { status: "warn", detail: rows[0]?.info ?? "connected (quota headers unavailable)" };
  } catch (error) {
    return { status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

function telemetryLabel(kind: ProviderSpec["telemetry"]): string {
  if (kind === "authoritative") return "authoritative";
  if (kind === "headers") return "header-based";
  return "status-only";
}

function summarizeSources(spec: ProviderSpec, resolved: Record<string, ResolvedField>): string {
  if (spec.fields.length === 0) return "n/a";

  return spec.fields
    .map((field) => `${field.id}:${resolved[field.id]?.source ?? "missing"}`)
    .join(", ");
}

function explainDetail(provider: ProviderSpec, validation: { status: "ok" | "warn" | "error"; detail: string }): string {
  if (validation.status === "ok") {
    return `metrics available (${telemetryLabel(provider.telemetry)})`;
  }

  if (validation.status === "warn") {
    const guidance = provider.guidance ? ` Next: ${provider.guidance}` : "";
    return `${validation.detail} [${telemetryLabel(provider.telemetry)}].${guidance}`;
  }

  const guidance = provider.guidance ? ` Next: ${provider.guidance}` : "";
  return `${validation.detail}.${guidance}`;
}

function guidanceFor(provider: ProviderSpec, resolved: Record<string, ResolvedField>): string | undefined {
  if (provider.id === "cloudflare-workers-ai" && resolved.accountId?.value) {
    return "Cloudflare accountId detected; dashboard-only telemetry is expected for many plans.";
  }
  return provider.guidance;
}

function parseRateLimitFromHeaders(headers: Headers): { requests?: string; tokens?: string } {
  const reqLimit =
    headers.get("x-ratelimit-limit-requests") ??
    headers.get("x-ratelimit-limit-requests-minute") ??
    headers.get("x-ratelimit-limit-requests-day");
  const reqRemain =
    headers.get("x-ratelimit-remaining-requests") ??
    headers.get("x-ratelimit-remaining-requests-minute") ??
    headers.get("x-ratelimit-remaining-requests-day") ??
    headers.get("ratelimit-remaining");

  const tokLimit =
    headers.get("x-ratelimit-limit-tokens") ??
    headers.get("x-ratelimit-limit-tokens-minute") ??
    headers.get("x-ratelimit-limit-tokens-day");
  const tokRemain =
    headers.get("x-ratelimit-remaining-tokens") ??
    headers.get("x-ratelimit-remaining-tokens-minute") ??
    headers.get("x-ratelimit-remaining-tokens-day");

  return {
    requests: reqLimit && reqRemain ? `${reqRemain}/${reqLimit}` : undefined,
    tokens: tokLimit && tokRemain ? `${tokRemain}/${tokLimit}` : undefined,
  };
}

function chooseProbeModel(providerID: string, modelIDs: string[]): string | null {
  if (modelIDs.length === 0) return null;

  const preferences: Record<string, RegExp[]> = {
    openrouter: [/gpt-4o-mini/i, /llama-3\.1-8b-instruct/i, /qwen/i, /gemma/i, /instruct/i],
    groq: [/llama|mixtral|qwen|gemma/i],
    fireworks: [/instruct|chat|llama|mixtral|qwen|gemma/i],
    cerebras: [/instruct|chat|llama|qwen|gpt-oss/i],
    "nvidia-nim": [/llama-3\.1-8b-instruct/i, /nemotron|mistral|qwen|instruct/i],
    together: [/instruct|chat|llama|qwen|gemma|mixtral/i],
    deepinfra: [/instruct|chat|llama|qwen|gemma|mixtral/i],
    mistral: [/mistral-large|ministral|codestral|devstral|mixtral/i],
    cohere: [/command-r|command-a|command-r7b|embed|rerank/i],
  };

  const rules = preferences[providerID] ?? [/chat|instruct/i];
  for (const rule of rules) {
    const match = modelIDs.find((id) => rule.test(id));
    if (match) return match;
  }

  return modelIDs[0] ?? null;
}

function extractModelIDs(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  const data = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : Array.isArray(payload)
        ? payload
        : [];

  const modelIDs: string[] = [];
  for (const item of data as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = rec.id;
    if (typeof id === "string" && id.trim()) modelIDs.push(id.trim());
  }

  return modelIDs;
}

async function probeOneWord(
  providerID: string,
  token: string,
): Promise<{ status: "ok" | "warn" | "error"; detail: string }> {
  const endpoints: Record<string, { models: string; chat: string }> = {
    openrouter: {
      models: "https://openrouter.ai/api/v1/models",
      chat: "https://openrouter.ai/api/v1/chat/completions",
    },
    groq: {
      models: "https://api.groq.com/openai/v1/models",
      chat: "https://api.groq.com/openai/v1/chat/completions",
    },
    fireworks: {
      models: "https://api.fireworks.ai/inference/v1/models",
      chat: "https://api.fireworks.ai/inference/v1/chat/completions",
    },
    cerebras: {
      models: "https://api.cerebras.ai/v1/models",
      chat: "https://api.cerebras.ai/v1/chat/completions",
    },
    "nvidia-nim": {
      models: "https://integrate.api.nvidia.com/v1/models",
      chat: "https://integrate.api.nvidia.com/v1/chat/completions",
    },
    together: {
      models: "https://api.together.xyz/v1/models",
      chat: "https://api.together.xyz/v1/chat/completions",
    },
    deepinfra: {
      models: "https://api.deepinfra.com/v1/openai/models",
      chat: "https://api.deepinfra.com/v1/openai/chat/completions",
    },
    mistral: {
      models: "https://api.mistral.ai/v1/models",
      chat: "https://api.mistral.ai/v1/chat/completions",
    },
    cohere: {
      models: "https://api.cohere.ai/v1/models",
      chat: "https://api.cohere.ai/v2/chat",
    },
  };

  const target = endpoints[providerID];
  if (!target) return { status: "warn", detail: "probe not implemented for provider" };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const modelsRes = await fetch(target.models, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!modelsRes.ok) {
      return { status: "error", detail: `probe models failed (${modelsRes.status})` };
    }

    const modelPayload = await modelsRes.json();
    const modelIDs = extractModelIDs(modelPayload);
    const modelID = chooseProbeModel(providerID, modelIDs);
    if (!modelID) {
      return { status: "warn", detail: "probe models returned no usable model id" };
    }

    const probeRes = await fetch(target.chat, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: "reply with one word: ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: ctrl.signal,
    });

    const limits = parseRateLimitFromHeaders(probeRes.headers);
    if (limits.requests || limits.tokens) {
      const pieces = [
        limits.requests ? `requests ${limits.requests}` : "",
        limits.tokens ? `tokens ${limits.tokens}` : "",
      ].filter(Boolean);
      return { status: "ok", detail: `probe captured headers: ${pieces.join(", ")}` };
    }

    if (probeRes.ok) {
      return { status: "warn", detail: "probe succeeded but provider returned no rate-limit headers" };
    }

    return { status: "warn", detail: `probe completed without headers (${probeRes.status})` };
  } catch (error) {
    return { status: "error", detail: `probe error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertProviderConfig(spec: ProviderSpec, values: Record<string, string>): Promise<string> {
  const dir = join(homedir(), ".config", "opencode");
  const path = join(dir, spec.configFile);
  await mkdir(dir, { recursive: true });

  let current: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      current = parsed as Record<string, unknown>;
    }
  } catch {
    // Create a new file.
  }

  const next = { ...current, ...values };
  await writeFile(path, JSON.stringify(next, null, 2));
  return path;
}

function statusEmoji(status: "ok" | "warn" | "error"): string {
  if (status === "ok") return "OK ";
  if (status === "warn") return "WRN";
  return "ERR";
}

export async function runAuthDoctor(options: DoctorOptions = {}): Promise<void> {
  console.log("\nAuth Doctor\n-----------");
  console.log("Legend: authoritative = explicit quota API, header-based = limits from response headers, status-only = connectivity only\n");

  for (const provider of PROVIDERS) {
    const resolved = await resolveAllFields(provider);
    const missing = provider.fields.filter((field) => field.required && !resolved[field.id]?.value);
    const sourceSummary = summarizeSources(provider, resolved);

    if (missing.length > 0) {
      const fieldList = missing.map((f) => f.id).join(", ");
      const dynamicGuidance = guidanceFor(provider, resolved);
      const guidance = dynamicGuidance ? ` Next: ${dynamicGuidance}` : "";
      console.log(`${statusEmoji("error")} ${provider.name.padEnd(24)} missing required fields (${fieldList}) [${telemetryLabel(provider.telemetry)}].${guidance} | ${sourceSummary}`);
      continue;
    }

    const validation = await validateProvider(provider.id);
    const dynamicProvider = {
      ...provider,
      guidance: guidanceFor(provider, resolved),
    };

    let probeSuffix = "";
    if (options.probe && provider.telemetry === "headers" && validation.status !== "ok") {
      const tokenField = resolved.apiKey?.value ?? resolved.apiToken?.value;
      if (tokenField) {
        const probe = await probeOneWord(provider.id, tokenField);
        probeSuffix = ` | probe:${probe.status}:${probe.detail}`;
      } else {
        probeSuffix = " | probe:warn:no token available for probe";
      }
    }

    const verboseSuffix = options.verbose
      ? ` | telemetry=${telemetryLabel(provider.telemetry)} setup=${provider.setupMode ?? "interactive"}`
      : "";

    console.log(`${statusEmoji(validation.status)} ${provider.name.padEnd(24)} ${explainDetail(dynamicProvider, validation)} | ${sourceSummary}${verboseSuffix}${probeSuffix}`);
  }

  console.log("\nTip: run `opencode-quotas auth setup` to fill missing fields interactively.");
  if (!options.probe) {
    console.log("Tip: add `--probe` to run lightweight one-word header probes for header-based providers.");
  }
  console.log("");
}

export async function runAuthSetup(providerArg?: string): Promise<void> {
  let provider = parseProviderArg(providerArg);
  if (!provider) {
    provider = await chooseProviderInteractively();
  }

  if (!provider) {
    process.exit(1);
  }

  const resolved = await resolveAllFields(provider);

  if (provider.setupMode === "managed") {
    console.log(`\n${provider.name} is managed by OpenCode/OAuth flow.`);
    const dynamicGuidance = guidanceFor(provider, resolved);
    if (dynamicGuidance) {
      console.log(dynamicGuidance);
    }
    const validation = await validateProvider(provider.id);
    const dynamicProvider = {
      ...provider,
      guidance: dynamicGuidance,
    };
    console.log(`${statusEmoji(validation.status)} ${provider.name}: ${explainDetail(dynamicProvider, validation)}\n`);
    return;
  }

  console.log(`\nAuth Setup: ${provider.name}`);

  for (const field of provider.fields) {
    const item = resolved[field.id];
    const shown = item?.value ? (field.secret ? maskSecret(item.value) : item.value) : "(missing)";
    console.log(`- ${field.label}: ${shown} [${item?.source ?? "missing"}]`);
  }

  const editMode = (await promptInput("Edit values now? (y/n)", "y")).toLowerCase().startsWith("y");
  if (!editMode) {
    const validation = await validateProvider(provider.id);
    console.log(`\n${statusEmoji(validation.status)} ${provider.name}: ${validation.detail}\n`);
    return;
  }

  const updates: Record<string, string> = {};
  for (const field of provider.fields) {
    const existing = resolved[field.id]?.value ?? "";
    let answer = "";

    if (field.secret) {
      const shouldChange = (await promptInput(`Set ${field.label}? (y/n)`, existing ? "n" : "y"))
        .toLowerCase()
        .startsWith("y");
      if (shouldChange) {
        answer = await promptHidden(`Enter ${field.label}`);
      }
    } else {
      answer = await promptInput(`Enter ${field.label}`, existing || undefined);
    }

    const value = answer || existing;
    if (field.required && !value) {
      console.error(`${field.label} is required.`);
      process.exit(1);
    }

    if (value) {
      updates[field.id] = value;
    }
  }

  const savedPath = await upsertProviderConfig(provider, updates);
  const validation = await validateProvider(provider.id);

  console.log(`\nSaved ${provider.name} auth config to ${savedPath}`);
  console.log(`${statusEmoji(validation.status)} ${provider.name}: ${validation.detail}\n`);
}

export async function runAuthLogin(providerArg?: string): Promise<void> {
  const provider = parseProviderArg(providerArg);
  if (!provider) {
    console.error("\nUsage: opencode-quotas auth login <provider>\n");
    await showAuthHelp();
    process.exit(1);
  }

  const mapped = LOGIN_PROVIDER_MAP[provider.id];
  if (!mapped) {
    console.error(`\nNo login command mapping found for ${provider.name}.`);
    console.error("Use your provider's native login flow and then re-run auth doctor.\n");
    process.exit(1);
  }

  console.log(`\nLaunching login flow for ${provider.name}: ${mapped.cmd} ${mapped.args.join(" ")}\n`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(mapped.cmd, mapped.args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`login command exited with code ${code ?? "unknown"}`));
    });
  });

  console.log("\nLogin flow complete. Running auth doctor...\n");
  await runAuthDoctor({ verbose: true });
}

export async function showAuthHelp(): Promise<void> {
  console.log(`
Auth commands

USAGE:
  opencode-quotas auth doctor
  opencode-quotas auth doctor --verbose
  opencode-quotas auth doctor --probe
  opencode-quotas auth login <provider>
  opencode-quotas auth setup [provider]
  opencode-quotas auth import <env-file>
  opencode-quotas auth export [--output <file>] [--mask]

PROVIDERS:
  ${PROVIDERS.map((p) => p.id).join(", ")}

NOTES:
  - The auth doctor prefers OpenCode credentials first.
  - setup prompts for missing/edited fields and writes to ~/.config/opencode/<provider>-auth.json.
  - providers marked as OAuth-managed (Codex/Copilot/Claude/Gemini/Antigravity) are read-only in setup.
  - Secrets are masked in output.
  - import/export works with OpenCode auth.json for portable API key management.
`);
}

import { importAuthFromEnv, exportAuthToEnv } from "./env-manager.js";

export async function runAuthImport(envFilePath: string): Promise<void> {
  if (!envFilePath) {
    console.error("\nUsage: opencode-quotas auth import <env-file>");
    console.error("\nExample:");
    console.error("  opencode-quotas auth import ./api-keys.env");
    console.error("\nSupported env vars:");
    console.error("  ANTHROPIC_API_KEY, CEREBRAS_API_KEY, COHERE_API_KEY,");
    console.error("  DEEPINFRA_API_KEY, FIREWORKS_API_KEY, GEMINI_API_KEY,");
    console.error("  GROQ_API_KEY, HUGGINGFACE_API_KEY, MINIMAX_API_KEY,");
    console.error("  MISTRAL_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY,");
    console.error("  TOGETHER_API_KEY, ZAI_API_KEY,");
    console.error("  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID");
    process.exit(1);
  }

  console.log(`\n📥 Importing auth from ${envFilePath}...\n`);
  
  try {
    const result = await importAuthFromEnv(envFilePath);
    
    if (result.imported.length > 0) {
      console.log(`✅ Imported ${result.imported.length} API key provider(s):`);
      for (const provider of result.imported) {
        console.log(`   - ${provider}`);
      }
    }
    
    if (result.oauth.length > 0) {
      console.log(`\n⚠️  Skipped ${result.oauth.length} OAuth provider(s) (already configured):`);
      for (const provider of result.oauth) {
        console.log(`   - ${provider} (use: opencode auth login ${provider})`);
      }
    }
    
    if (result.skipped.length > 0) {
      console.log(`\nℹ️  Ignored unknown env vars:`);
      for (const envVar of result.skipped.slice(0, 5)) {
        console.log(`   - ${envVar}`);
      }
      if (result.skipped.length > 5) {
        console.log(`   ... and ${result.skipped.length - 5} more`);
      }
    }
    
    if (result.backupPath) {
      console.log(`\n💾 Backup created: ${result.backupPath}`);
    }
    
    console.log("\n✨ Import complete! Run 'opencode-quotas auth doctor' to verify.\n");
  } catch (error) {
    console.error("\n❌ Import failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function runAuthExport(outputPath?: string, mask = false): Promise<void> {
  console.log(mask ? "\n📤 Exporting auth (masked)...\n" : "\n📤 Exporting auth...\n");
  
  try {
    const envContent = await exportAuthToEnv({ mask });
    
    if (outputPath) {
      await writeFile(outputPath, envContent, 'utf-8');
      console.log(`✅ Auth exported to: ${outputPath}`);
      console.log(`\n💡 Import on another machine with:`);
      console.log(`   opencode-quotas auth import ${outputPath}\n`);
    } else {
      console.log(envContent);
    }
  } catch (error) {
    console.error("\n❌ Export failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
