import type { BalanceInfo, IBalanceChecker } from "../interfaces";
import { logger } from "../logger";

interface BalanceEndpoint {
    url: string;
    method: "GET";
    parseResponse: (data: unknown) => Partial<BalanceInfo>;
}

const BALANCE_ENDPOINTS: Record<string, BalanceEndpoint> = {
    openrouter: {
        url: "https://openrouter.ai/api/v1/key",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const info = (d.data as Record<string, unknown>) || {};
            const limit = info.limit as number | null;
            const limitRemaining = info.limit_remaining as number | null;

            return {
                provider: "openrouter",
                creditsUsd: limitRemaining ?? undefined,
                isPayAsYouGo: limit !== null,
                isSubscription: false,
                lastUpdated: new Date(),
            };
        },
    },
    together: {
        url: "https://api.together.ai/v1/user/info",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const account = (d.account as Record<string, unknown>) || {};
            const billing = (account.billing as Record<string, unknown>) || {};
            const availableCredits = billing.available_credits as number | null;

            return {
                provider: "together",
                creditsUsd: availableCredits ?? undefined,
                isPayAsYouGo: true,
                isSubscription: false,
                lastUpdated: new Date(),
            };
        },
    },
    deepinfra: {
        url: "https://api.deepinfra.com/v1/user/balance",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const balance = d.balance as number | null;

            return {
                provider: "deepinfra",
                creditsUsd: balance ?? undefined,
                isPayAsYouGo: true,
                isSubscription: false,
                lastUpdated: new Date(),
            };
        },
    },
    cerebras: {
        url: "https://api.cerebras.ai/v1/user/info",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const account = (d.account as Record<string, unknown>) || {};
            const billing = (account.billing as Record<string, unknown>) || {};
            const availableCredits = billing.available_credits as number | null;

            return {
                provider: "cerebras",
                creditsUsd: availableCredits ?? undefined,
                isPayAsYouGo: true,
                isSubscription: false,
                minimumDeposit: 10,
                lastUpdated: new Date(),
            };
        },
    },
    fireworks: {
        url: "https://api.fireworks.ai/v1/user/credits",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const credits = d.credits as number | null;

            return {
                provider: "fireworks",
                creditsUsd: credits ?? undefined,
                isPayAsYouGo: true,
                isSubscription: false,
                minimumDeposit: 1,
                lastUpdated: new Date(),
            };
        },
    },
    mistral: {
        url: "https://api.mistral.ai/v1/user/info",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const credits = d.credits as number | null;
            const subscription = d.subscription as Record<string, unknown> | null;
            const isSubscription = subscription?.status === "active";

            return {
                provider: "mistral",
                creditsUsd: credits ?? undefined,
                isPayAsYouGo: !isSubscription,
                isSubscription: isSubscription,
                lastUpdated: new Date(),
            };
        },
    },
    cohere: {
        url: "https://api.cohere.ai/v1/user/subscription",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const subscription = d.subscription as Record<string, unknown> | null;
            const plan = subscription?.plan as string | null;

            return {
                provider: "cohere",
                isPayAsYouGo: plan === "pay_as_you_go",
                isSubscription: plan === "pro",
                lastUpdated: new Date(),
            };
        },
    },
    "nvidia-nim": {
        url: "https://ngc.api.nvidia.com/v0/identity/credits",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const credits = d.credits as number | null;

            return {
                provider: "nvidia-nim",
                creditsUsd: credits ?? undefined,
                isPayAsYouGo: true,
                isSubscription: false,
                lastUpdated: new Date(),
            };
        },
    },
    huggingface: {
        url: "https://huggingface.co/api/whoami-v2",
        method: "GET",
        parseResponse: (data: unknown) => {
            const d = data as Record<string, unknown>;
            const opts = (d.attrs as Record<string, unknown>) || {};
            const hasSpaces = opts.hasSpaces as boolean | null;

            return {
                provider: "huggingface",
                isPayAsYouGo: false,
                isSubscription: hasSpaces ?? false,
                lastUpdated: new Date(),
            };
        },
    },
    cloudflare: {
        url: "https://api.cloudflare.com/client/v4/user/tokens/verify",
        method: "GET",
        parseResponse: () => {
            return {
                provider: "cloudflare",
                isPayAsYouGo: false,
                isSubscription: false,
                note: "Free tier - 10K requests/day",
                lastUpdated: new Date(),
            };
        },
    },
};

export class BalanceChecker implements IBalanceChecker {
    private cache: Map<string, BalanceInfo> = new Map();
    private cacheTtlMs = 5 * 60 * 1000;

    constructor(
        private getApiKey: (provider: string) => Promise<string | null>
    ) {}

    async checkBalance(provider: string): Promise<BalanceInfo | null> {
        const cached = this.cache.get(provider);
        if (cached && Date.now() - cached.lastUpdated.getTime() < this.cacheTtlMs) {
            return cached;
        }

        const endpoint = BALANCE_ENDPOINTS[provider];
        if (!endpoint) {
            logger.debug(`[balance] No balance endpoint for provider: ${provider}`);
            return null;
        }

        try {
            const apiKey = await this.getApiKey(provider);
            if (!apiKey) {
                return null;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            try {
                const response = await fetch(endpoint.url, {
                    method: endpoint.method,
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        Accept: "application/json",
                    },
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    logger.debug(
                        `[balance] HTTP ${response.status} for ${provider}`
                    );
                    return null;
                }

                const data = await response.json();
                const partial = endpoint.parseResponse(data);

                const result: BalanceInfo = {
                    provider,
                    credits: partial.credits,
                    creditsUsd: partial.creditsUsd,
                    freeTierRemaining: partial.freeTierRemaining,
                    isPayAsYouGo: partial.isPayAsYouGo ?? false,
                    isSubscription: partial.isSubscription ?? false,
                    minimumDeposit: partial.minimumDeposit,
                    lastUpdated: partial.lastUpdated ?? new Date(),
                };

                this.cache.set(provider, result);
                return result;
            } finally {
                clearTimeout(timeout);
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.debug(`[balance] Error checking ${provider}: ${errorMsg}`);
            return null;
        }
    }

    async checkAllBalances(): Promise<BalanceInfo[]> {
        const providers = Object.keys(BALANCE_ENDPOINTS);
        const results = await Promise.all(
            providers.map((p) => this.checkBalance(p))
        );
        return results.filter((r): r is BalanceInfo => r !== null);
    }

    hasBalanceEndpoint(provider: string): boolean {
        return provider in BALANCE_ENDPOINTS;
    }
}

let instance: BalanceChecker | null = null;
let currentGetApiKey: ((provider: string) => Promise<string | null>) | null = null;

export function getBalanceChecker(
    getApiKey: (provider: string) => Promise<string | null>
): BalanceChecker {
    // Always create a new instance to ensure fresh getApiKey function
    // This prevents stale cached instances from causing batch mode failures
    instance = new BalanceChecker(getApiKey);
    currentGetApiKey = getApiKey;
    return instance;
}
