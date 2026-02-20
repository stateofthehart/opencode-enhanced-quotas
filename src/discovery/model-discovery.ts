import type {
    DiscoveredModel,
    IModelDiscovery,
    ModelInfo,
    ProviderDiscoveryConfig,
    ProviderModelList,
} from "../interfaces";
import { logger } from "../logger";

const PROVIDER_DISCOVERY_CONFIGS: Record<string, ProviderDiscoveryConfig> = {
    groq: {
        id: "groq",
        name: "Groq",
        modelsEndpoint: "https://api.groq.com/openai/v1/models",
        rateLimitType: "per_model",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
    },
    cerebras: {
        id: "cerebras",
        name: "Cerebras",
        modelsEndpoint: "https://api.cerebras.ai/v1/models",
        rateLimitType: "per_model",
        hasFreeTier: true,
        minimumDeposit: 10,
        modelIdField: "id",
    },
    fireworks: {
        id: "fireworks",
        name: "Fireworks AI",
        modelsEndpoint: "https://api.fireworks.ai/inference/v1/models",
        rateLimitType: "provider_wide",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
    },
    together: {
        id: "together",
        name: "Together AI",
        modelsEndpoint: "https://api.together.xyz/v1/models",
        rateLimitType: "per_model",
        hasFreeTier: false,
        minimumDeposit: 5,
        modelIdField: "id",
    },
    deepinfra: {
        id: "deepinfra",
        name: "DeepInfra",
        modelsEndpoint: "https://api.deepinfra.com/v1/models",
        rateLimitType: "per_model",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
    },
    mistral: {
        id: "mistral",
        name: "Mistral",
        modelsEndpoint: "https://api.mistral.ai/v1/models",
        rateLimitType: "provider_wide",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
    },
    cohere: {
        id: "cohere",
        name: "Cohere",
        modelsEndpoint: "https://api.cohere.ai/v1/models",
        defaultModels: [
            "command-light",
            "command-light-nightly",
        ],
        rateLimitType: "per_model",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "name",
    },
    openrouter: {
        id: "openrouter",
        name: "OpenRouter",
        modelsEndpoint: "https://openrouter.ai/api/v1/models",
        rateLimitType: "per_model",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
        freeModelFilter: (model: Record<string, unknown>) => {
            const pricing = model.pricing as Record<string, string> | undefined;
            if (!pricing) return false;
            const prompt = parseFloat(pricing.prompt || "999");
            const completion = parseFloat(pricing.completion || "999");
            return prompt === 0 && completion === 0;
        },
    },
    "nvidia-nim": {
        id: "nvidia-nim",
        name: "NVIDIA NIM",
        modelsEndpoint: "https://integrate.api.nvidia.com/v1/models",
        rateLimitType: "provider_wide",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
    },
    huggingface: {
        id: "huggingface",
        name: "Hugging Face",
        modelsEndpoint: "https://huggingface.co/api/models",
        rateLimitType: "provider_wide",
        hasFreeTier: true,
        minimumDeposit: 0,
        modelIdField: "id",
    },
    cloudflare: {
        id: "cloudflare",
        name: "Cloudflare Workers AI",
        modelsEndpoint: undefined,
        defaultModels: [
            "@cf/meta/llama-3.1-8b-instruct",
            "@cf/meta/llama-3.1-8b-instruct-fp8",
            "@cf/meta/llama-3.2-1b-instruct",
            "@cf/meta/llama-3.2-11b-vision-instruct",
            "@cf/meta/llama-3.3-70b-instruct",
            "@cf/meta/llama-guard-3-8b",
            "@cf/deepseek-ai/deepseek-chat",
            "@cf/deepseek-ai/deepseek-coder",
            "@cf/qwen/qwen-2.5-7b-instruct",
            "@cf/qwen/qwen-2.5-72b-instruct",
            "@cf/google/gemma-2-2b-it",
            "@cf/google/gemma-2-27b-it",
            "@cf/openchat/openchat-7b",
            "@cf/tiiuae/falcon-7b-instruct",
            "@cf/thebloke/discolm-7b-v0.1",
            "@cf/thebloke/llemma_7b-instruct",
            "@cf/facebook/llama-3-8b-instruct",
            "@cf/ai21/j2-mid",
        ],
        modelIdField: "id",
        accountIdField: "accountId",
        rateLimitType: "provider_wide",
        hasFreeTier: true,
        minimumDeposit: 0,
    },
};

function isOpenAICompatibleResponse(data: unknown): data is { data: unknown[] } {
    return (
        typeof data === "object" &&
        data !== null &&
        "data" in data &&
        Array.isArray((data as Record<string, unknown>).data)
    );
}

function isDirectArrayResponse(data: unknown): data is unknown[] {
    return Array.isArray(data);
}

function normalizeOpenRouterModel(raw: Record<string, unknown>): DiscoveredModel {
    const id = String(raw.id || "");
    const pricing = raw.pricing as Record<string, string> | undefined;
    const promptPrice = pricing ? parseFloat(pricing.prompt || "999") : 999;
    const completionPrice = pricing ? parseFloat(pricing.completion || "999") : 999;
    const isFree = promptPrice === 0 && completionPrice === 0;
    const topProvider = raw.top_provider as Record<string, unknown> | undefined;
    const isAvailable = topProvider?.context_length != null;

    return {
        id,
        name: String(raw.name || id),
        provider: "openrouter",
        contextWindow: (raw.context_length as number) || (topProvider?.context_length as number),
        pricing: {
            prompt: promptPrice,
            completion: completionPrice,
        },
        isFree,
        isAvailable,
        discoveredAt: new Date(),
        lastChecked: new Date(),
    };
}

function normalizeGroqModel(raw: Record<string, unknown>): DiscoveredModel {
    const id = String(raw.id || "");
    return {
        id,
        name: String(raw.id || ""),
        provider: "groq",
        contextWindow: (raw.context_window as number) || undefined,
        isFree: true,
        isAvailable: (raw.active as boolean) !== false,
        discoveredAt: new Date(),
        lastChecked: new Date(),
    };
}

function normalizeCerebrasModel(raw: Record<string, unknown>): DiscoveredModel {
    const id = String(raw.id || "");
    return {
        id,
        name: String(raw.id || ""),
        provider: "cerebras",
        isFree: true,
        isAvailable: true,
        discoveredAt: new Date(),
        lastChecked: new Date(),
    };
}

function normalizeGenericModel(raw: Record<string, unknown>, provider: string): DiscoveredModel {
    const id = String(raw.id || raw.name || "");
    return {
        id,
        name: String(raw.name || raw.id || ""),
        provider,
        contextWindow: (raw.context_length as number) || undefined,
        isFree: true,
        isAvailable: true,
        discoveredAt: new Date(),
        lastChecked: new Date(),
    };
}

export class ModelDiscovery implements IModelDiscovery {
    private cache: Map<string, ProviderModelList> = new Map();
    private cacheTtlMs = 5 * 60 * 1000;

    constructor(
        private getApiKey: (provider: string) => Promise<string | null>
    ) {}

    async discoverModels(provider: string): Promise<ProviderModelList> {
        const cached = this.cache.get(provider);
        if (cached && Date.now() - cached.fetchedAt.getTime() < this.cacheTtlMs) {
            return cached;
        }

        const config = PROVIDER_DISCOVERY_CONFIGS[provider];
        if (!config) {
            return {
                provider,
                models: [],
                fetchedAt: new Date(),
                error: `No discovery config for provider: ${provider}`,
            };
        }

        // Handle providers with defaultModels (like Cloudflare) that don't have a modelsEndpoint
        if (!config.modelsEndpoint && config.defaultModels) {
            const models: DiscoveredModel[] = config.defaultModels.map((modelId) => ({
                id: modelId,
                name: modelId,
                provider,
                isFree: true,
                isAvailable: true,
                discoveredAt: new Date(),
                lastChecked: new Date(),
            }));

            const result: ProviderModelList = {
                provider,
                models,
                fetchedAt: new Date(),
            };

            this.cache.set(provider, result);
            return result;
        }

        if (!config.modelsEndpoint) {
            return {
                provider,
                models: [],
                fetchedAt: new Date(),
                error: `No models endpoint for provider: ${provider}`,
            };
        }

        try {
            const apiKey = await this.getApiKey(provider);
            if (!apiKey) {
                return {
                    provider,
                    models: [],
                    fetchedAt: new Date(),
                    error: "No API key available",
                };
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            try {
                const response = await fetch(config.modelsEndpoint, {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        Accept: "application/json",
                    },
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    // Fall back to defaultModels if available (for rate limited providers like Cohere)
                    if (config.defaultModels && response.status === 429) {
                        const models: DiscoveredModel[] = config.defaultModels.map((modelId) => ({
                            id: modelId,
                            name: modelId,
                            provider,
                            isFree: true,
                            isAvailable: true,
                            discoveredAt: new Date(),
                            lastChecked: new Date(),
                        }));

                        const result: ProviderModelList = {
                            provider,
                            models,
                            fetchedAt: new Date(),
                            error: `Rate limited (HTTP 429), using default models`,
                        };

                        this.cache.set(provider, result);
                        return result;
                    }

                    return {
                        provider,
                        models: [],
                        fetchedAt: new Date(),
                        error: `HTTP ${response.status}: ${response.statusText}`,
                    };
                }

                const data = await response.json();
                const models = this.parseModelsResponse(data, provider, config);

                const result: ProviderModelList = {
                    provider,
                    models,
                    fetchedAt: new Date(),
                };

                this.cache.set(provider, result);
                return result;
            } finally {
                clearTimeout(timeout);
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.debug(`[discovery] Error discovering ${provider}: ${errorMsg}`);
            return {
                provider,
                models: [],
                fetchedAt: new Date(),
                error: errorMsg,
            };
        }
    }

    private parseModelsResponse(
        data: unknown,
        provider: string,
        config: ProviderDiscoveryConfig
    ): DiscoveredModel[] {
        let models: Record<string, unknown>[] = [];

        if (isOpenAICompatibleResponse(data)) {
            models = data.data as Record<string, unknown>[];
        } else if (isDirectArrayResponse(data)) {
            models = data as Record<string, unknown>[];
        } else if (typeof data === "object" && data !== null) {
            const obj = data as Record<string, unknown>;
            if (obj.models && Array.isArray(obj.models)) {
                models = obj.models as Record<string, unknown>[];
            }
        }

        if (provider === "openrouter") {
            return models.map(normalizeOpenRouterModel);
        }

        if (provider === "groq") {
            return models.map(normalizeGroqModel);
        }

        if (provider === "cerebras") {
            return models.map(normalizeCerebrasModel);
        }

        return models.map((m) => normalizeGenericModel(m, provider));
    }

    async discoverAll(): Promise<ProviderModelList[]> {
        const providers = Object.keys(PROVIDER_DISCOVERY_CONFIGS);
        const results = await Promise.all(providers.map((p) => this.discoverModels(p)));
        return results;
    }

    async getFreeModels(provider: string): Promise<DiscoveredModel[]> {
        const result = await this.discoverModels(provider);
        if (result.error) return [];
        return result.models.filter((m) => m.isFree && m.isAvailable);
    }

    async getAvailableModels(provider: string, _minBalance?: number): Promise<DiscoveredModel[]> {
        const result = await this.discoverModels(provider);
        if (result.error) return [];
        return result.models.filter((m) => m.isAvailable);
    }

    getConfig(provider: string): ProviderDiscoveryConfig | undefined {
        return PROVIDER_DISCOVERY_CONFIGS[provider];
    }

    getAllConfigs(): Record<string, ProviderDiscoveryConfig> {
        return PROVIDER_DISCOVERY_CONFIGS;
    }
}

let instance: ModelDiscovery | null = null;
let currentGetApiKey: ((provider: string) => Promise<string | null>) | null = null;

export function getModelDiscovery(
    getApiKey: (provider: string) => Promise<string | null>
): ModelDiscovery {
    // Always create a new instance to ensure fresh getApiKey function
    // This prevents stale cached instances from causing batch mode failures
    instance = new ModelDiscovery(getApiKey);
    currentGetApiKey = getApiKey;
    return instance;
}

export function getDiscovery(): ModelDiscovery {
    const { readApiKey } = require("../providers/provider-utils.js");
    return new ModelDiscovery(async (provider: string) => {
        return readApiKey([], [], [], [provider]);
    });
}
