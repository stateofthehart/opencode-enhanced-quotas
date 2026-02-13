import { DEFAULT_CONFIG } from "../defaults.js";
import { 
    type QuotaConfig, 
    type QuotaData, 
    type IQuotaProvider, 
    type IHistoryService,
    type IPredictionEngine,
    type IAggregationService,
    type AggregatedGroup
} from "../interfaces.js";
import { getQuotaRegistry } from "../registry.js";
import { createAntigravityProvider } from "../providers/antigravity/index.js";
import { createCodexProvider } from "../providers/codex.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createCopilotProvider } from "../providers/copilot.js";
import { createCursorProvider } from "../providers/cursor.js";
import { createZaiProvider } from "../providers/zai.js";
import { createMiniMaxProvider } from "../providers/minimax.js";
import { createJetBrainsProvider } from "../providers/jetbrains.js";
import { createGeminiProvider } from "../providers/gemini.js";
import { createOpenRouterProvider } from "../providers/openrouter.js";
import { createNvidiaNimProvider } from "../providers/nvidia-nim.js";
import { createCerebrasProvider } from "../providers/cerebras.js";
import { createFireworksProvider } from "../providers/fireworks.js";
import { createCloudflareWorkersAIProvider } from "../providers/cloudflare-workers-ai.js";
import { createHuggingFaceProvider } from "../providers/huggingface.js";
import { createGroqProvider } from "../providers/groq.js";
import { formatDurationMs } from "../utils/time.js";
import { logger } from "../logger.js";
import { LinearRegressionPredictionEngine, NullPredictionEngine } from "./prediction-engine.js";
import { AggregationService } from "./aggregation-service.js";
import { ConfigLoader } from "./config-loader.js";

export class QuotaService {
    private config: QuotaConfig;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private historyService?: IHistoryService;
    private predictionEngine: IPredictionEngine;
    private aggregationService: IAggregationService;

    constructor(initialConfig?: Partial<QuotaConfig>) {
        this.config = ConfigLoader.createConfig(initialConfig);
        
        // Initialize with null prediction engine until init() is called
        this.predictionEngine = new NullPredictionEngine();
        this.aggregationService = new AggregationService(this.predictionEngine);
    }

    async init(directory: string, historyService?: IHistoryService): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                this.historyService = historyService;

                // Load config from disk
                this.config = await ConfigLoader.loadFromDisk(directory, this.config);

                if (this.historyService && this.config.historyMaxAgeHours !== undefined) {
                    this.historyService.setMaxAge(this.config.historyMaxAgeHours);
                }

                if (this.historyService && this.config.historyResetThreshold !== undefined) {
                    this.historyService.setResetThreshold(this.config.historyResetThreshold);
                }

                // Initialize prediction engine with history service
                if (this.historyService) {
                    this.predictionEngine = new LinearRegressionPredictionEngine(
                        this.historyService,
                        { predictionShortWindowMinutes: this.config.predictionShortWindowMinutes }
                    );
                }
                // Re-initialize aggregation service with the new prediction engine
                this.aggregationService = new AggregationService(this.predictionEngine);

                // Register providers
                await this.registerProviders();

                this.initialized = true;
            } catch (e) {
                this.initPromise = null;
                throw e;
            }
        })();
        
        return this.initPromise;
    }

    private async registerProviders(): Promise<void> {
        const registry = getQuotaRegistry();

        // Register Antigravity
        try {
            registry.register(
                createAntigravityProvider({
                    debug: !!this.config.debug,
                }),
            );
            logger.debug("init:provider_registered", { id: "antigravity" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "antigravity", error: e });
            logger.warn("init:provider_failed_visible", { id: "antigravity" });
        }

        // Register Codex
        try {
            registry.register(createCodexProvider());
            logger.debug("init:provider_registered", { id: "codex" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "codex", error: e });
            logger.warn("init:provider_failed_visible", { id: "codex" });
        }

        // Register Anthropic (Claude)
        try {
            registry.register(createAnthropicProvider());
            logger.debug("init:provider_registered", { id: "anthropic" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "anthropic", error: e });
            logger.warn("init:provider_failed_visible", { id: "anthropic" });
        }

        // Register GitHub Copilot
        try {
            registry.register(createCopilotProvider());
            logger.debug("init:provider_registered", { id: "copilot" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "copilot", error: e });
            logger.warn("init:provider_failed_visible", { id: "copilot" });
        }

        // Register Cursor
        try {
            registry.register(createCursorProvider());
            logger.debug("init:provider_registered", { id: "cursor" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "cursor", error: e });
            logger.warn("init:provider_failed_visible", { id: "cursor" });
        }

        // Register z.ai (Grok)
        try {
            registry.register(createZaiProvider());
            logger.debug("init:provider_registered", { id: "zai" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "zai", error: e });
            logger.warn("init:provider_failed_visible", { id: "zai" });
        }

        // Register MiniMax
        try {
            registry.register(createMiniMaxProvider());
            logger.debug("init:provider_registered", { id: "minimax" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "minimax", error: e });
            logger.warn("init:provider_failed_visible", { id: "minimax" });
        }

        // Register JetBrains AI
        try {
            registry.register(createJetBrainsProvider());
            logger.debug("init:provider_registered", { id: "jetbrains" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "jetbrains", error: e });
            logger.warn("init:provider_failed_visible", { id: "jetbrains" });
        }

        // Register Gemini
        try {
            registry.register(createGeminiProvider());
            logger.debug("init:provider_registered", { id: "gemini" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "gemini", error: e });
            logger.warn("init:provider_failed_visible", { id: "gemini" });
        }

        // Register OpenRouter
        try {
            registry.register(createOpenRouterProvider());
            logger.debug("init:provider_registered", { id: "openrouter" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "openrouter", error: e });
            logger.warn("init:provider_failed_visible", { id: "openrouter" });
        }

        // Register NVIDIA NIM
        try {
            registry.register(createNvidiaNimProvider());
            logger.debug("init:provider_registered", { id: "nvidia-nim" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "nvidia-nim", error: e });
            logger.warn("init:provider_failed_visible", { id: "nvidia-nim" });
        }

        // Register Cerebras
        try {
            registry.register(createCerebrasProvider());
            logger.debug("init:provider_registered", { id: "cerebras" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "cerebras", error: e });
            logger.warn("init:provider_failed_visible", { id: "cerebras" });
        }

        // Register Fireworks
        try {
            registry.register(createFireworksProvider());
            logger.debug("init:provider_registered", { id: "fireworks" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "fireworks", error: e });
            logger.warn("init:provider_failed_visible", { id: "fireworks" });
        }

        // Register Cloudflare Workers AI
        try {
            registry.register(createCloudflareWorkersAIProvider());
            logger.debug("init:provider_registered", { id: "cloudflare-workers-ai" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "cloudflare-workers-ai", error: e });
            logger.warn("init:provider_failed_visible", { id: "cloudflare-workers-ai" });
        }

        // Register Hugging Face
        try {
            registry.register(createHuggingFaceProvider());
            logger.debug("init:provider_registered", { id: "huggingface" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "huggingface", error: e });
            logger.warn("init:provider_failed_visible", { id: "huggingface" });
        }

        // Register Groq
        try {
            registry.register(createGroqProvider());
            logger.debug("init:provider_registered", { id: "groq" });
        } catch (e) {
            logger.error("init:provider_failed", { id: "groq", error: e });
            logger.warn("init:provider_failed_visible", { id: "groq" });
        }
    }

    getConfig(): QuotaConfig {
        return this.config;
    }

    getProviders(): IQuotaProvider[] {
        return getQuotaRegistry().getAll();
    }

    /**
     * Returns the prediction engine used by this service.
     * Useful for testing or for other services that need prediction capabilities.
     */
    getPredictionEngine(): IPredictionEngine {
        return this.predictionEngine;
    }

    private async fetchRawQuotas(): Promise<QuotaData[]> {
        const providers = this.getProviders();

        logger.debug(
            "quota_service:get_quotas_start",
            { providerCount: providers.length, ids: providers.map((p) => p.id) },
        );

        if (providers.length === 0) return [];

        const results = await Promise.all(
            providers.map(async (p: IQuotaProvider) => {
                const startedAt = Date.now();
                try {
                    logger.debug(
                        "quota_service:provider_fetch_start",
                        { id: p.id },
                    );
                    const result = await p.fetchQuota();
                    logger.debug(
                        "quota_service:provider_fetch_ok",
                        { id: p.id, count: result.length, durationMs: Date.now() - startedAt },
                    );
                    return result;
                } catch (e) {
                    logger.error(
                        "quota_service:provider_fetch_error",
                        { id: p.id, durationMs: Date.now() - startedAt, error: e },
                    );
                    return [];
                }
            })
        );

        return results.flat();
    }

    /**
     * Returns the aggregation service used by this service.
     * Useful for testing or for other services that need aggregation capabilities.
     */
    getAggregationService(): IAggregationService {
        return this.aggregationService;
    }

    async getQuotas(context?: { providerId?: string; modelId?: string }): Promise<QuotaData[]> {
        const rawResults = await this.fetchRawQuotas();
        const processed = this.processQuotas(rawResults, context);
        logger.debug(
            "quota_service:get_quotas_end",
            { totalCount: processed.length },
        );
        return processed;
    }

    async getCommandQuotas(context?: { providerId?: string; modelId?: string }): Promise<QuotaData[]> {
        const rawResults = await this.fetchRawQuotas();
        const processed = this.processQuotasForCommand(rawResults, context);
        logger.debug(
            "quota_service:get_command_quotas_end",
            { totalCount: processed.length },
        );
        return processed;
    }

    processQuotasForCommand(data: QuotaData[], context?: { providerId?: string; modelId?: string }): QuotaData[] {
        const originalAggregatedGroups = this.config.aggregatedGroups;
        const originalShowUnaggregated = this.config.showUnaggregated;
        this.config.aggregatedGroups = [];
        this.config.showUnaggregated = true;
        try {
            return this.processQuotas(data, context);
        } finally {
            this.config.aggregatedGroups = originalAggregatedGroups;
            this.config.showUnaggregated = originalShowUnaggregated;
        }
    }

    processQuotas(data: QuotaData[], context?: { providerId?: string; modelId?: string }): QuotaData[] {
        let results = [...data];

        // 1. Enrich with predictions (before aggregation so sources have it too)
        results = results.map(q => {
            const time = this.predictionEngine.predictTimeToLimit(
                q.id, 
                this.config.predictionWindowMinutes ?? 60,
                this.config.predictionShortWindowMinutes,
                { windowInfo: q.window }
            );
            if (time !== Infinity) {
                return {
                    ...q,
                    predictedReset: `${formatDurationMs(time)} (predicted)`
                };
            }
            return q;
        });

        // 2. Apply Aggregation
        results = this.applyAggregation(results);

        // 3. Filter (disabled quotas + optional model filtering).
        results = this.filterQuotas(results, context);

        // 4. Sort
        results = this.sortQuotas(results);

        return results;
    }

    private applyAggregation(quotas: QuotaData[]): QuotaData[] {
        if (!this.config.aggregatedGroups || this.config.aggregatedGroups.length === 0) {
            return quotas;
        }

        const aggregatedResults: QuotaData[] = [];
        let remainingQuotas = [...quotas];

        for (const group of this.config.aggregatedGroups) {
            // Resolve source quotas from explicit sources and patterns
            const sourceQuotas = this.resolveGroupSources(remainingQuotas, group);
            if (sourceQuotas.length === 0) continue;

            const strategy = group.strategy || "most_critical";
            let representative: QuotaData | null = null;

            if (strategy === "most_critical") {
                representative = this.aggregationService.aggregateMostCritical(
                    sourceQuotas, 
                    group.predictionWindowMinutes,
                    group.predictionShortWindowMinutes
                );
            } else if (strategy === "max") {
                representative = this.aggregationService.aggregateMax(sourceQuotas);
            } else if (strategy === "min") {
                representative = this.aggregationService.aggregateMin(sourceQuotas);
            } else if (strategy === "mean" || strategy === "median") {
                representative = this.aggregationService.aggregateAverage(
                    sourceQuotas, 
                    group.name, 
                    group.id, 
                    strategy
                );
            }

            if (representative) {
                // Create a copy for display
                const displayQuota = { 
                    ...representative, 
                    id: group.id, 
                    providerName: group.name 
                };

                // Remove matched sources from pool to avoid double aggregation
                const sourceIds = new Set(sourceQuotas.map(q => q.id));
                remainingQuotas = remainingQuotas.filter(q => !sourceIds.has(q.id));
                
                aggregatedResults.push(displayQuota);
            }
        }

        // Return aggregated results. 
        // If showUnaggregated is false, only return what matched a group.
        if (this.config.showUnaggregated === false) {
            return aggregatedResults;
        }

        return [...remainingQuotas, ...aggregatedResults];
    }

    /**
     * Resolves which quotas belong to an AggregatedGroup using explicit sources and patterns.
     */
    private matchPattern(pattern: string, target: string): { matched: boolean; matchType?: "token" | "regex" | "substr"; tokenIndex?: number; tokensCount?: number; matchIndex?: number; matchLength?: number } {
        const p = pattern.trim();
        const lowerTarget = target.toLowerCase();
        const lowerPattern = p.toLowerCase();

        const hasStar = p.includes("*");
        const hasQuestion = p.includes("?");
        const hasDotStar = p.includes(".*") || p.includes(".+");
        const hasOtherRegex = /[+^${}()|\[\]\\]/.test(p);

        try {
            if (hasStar || hasQuestion) {
                let regexStr = "";
                for (let i = 0; i < p.length; i++) {
                    const ch = p[i];
                    if (ch === "*") {
                        regexStr += ".*";
                    } else if (ch === "?") {
                        regexStr += ".";
                    } else {
                        regexStr += ch.replace(/[-\\/\^$+?.()|[\]{}]/g, "\\$&");
                    }
                }
                const regex = new RegExp(regexStr, "i");
                const m = regex.exec(target);
                if (m) {
                    return { matched: true, matchType: "regex", matchIndex: m.index, matchLength: m[0].length };
                }
                return { matched: false };
            }

            if (hasDotStar || hasOtherRegex) {
                try {
                    const regex = new RegExp(p, "i");
                    const m = regex.exec(target);
                    if (m) {
                        return { matched: true, matchType: "regex", matchIndex: m.index, matchLength: m[0].length };
                    }
                    return { matched: false };
                } catch (_) {
                }
            }

            const tokens = lowerTarget.split(/[^a-z0-9\-_]+/).filter(Boolean);
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i] === lowerPattern) {
                    return { matched: true, matchType: "token", tokenIndex: i, tokensCount: tokens.length };
                }
            }

            if (lowerTarget.includes(lowerPattern)) {
                const idx = lowerTarget.indexOf(lowerPattern);
                return { matched: true, matchType: "substr", matchIndex: idx, matchLength: lowerPattern.length };
            }

            return { matched: false };
        } catch (e) {
            return { matched: false };
        }
    }

    private resolveGroupSources(quotas: QuotaData[], group: AggregatedGroup): QuotaData[] {
        const matched: QuotaData[] = [];
        const matchedIds = new Set<string>();

        // 1. Explicit sources (highest priority)
        if (group.sources && group.sources.length > 0) {
            for (const quota of quotas) {
                if (group.sources.includes(quota.id)) {
                    matched.push(quota);
                    matchedIds.add(quota.id);
                }
            }
        }

        // 2. Pattern matching
        if (group.patterns && group.patterns.length > 0) {
            for (const quota of quotas) {
                // Skip if already matched by explicit source
                if (matchedIds.has(quota.id)) continue;

                // Filter by providerId if specified
                if (group.providerId) {
                    const providerMatch = 
                        quota.providerName.toLowerCase().includes(group.providerId.toLowerCase()) ||
                        quota.id.toLowerCase().startsWith(group.providerId.toLowerCase());
                    if (!providerMatch) continue;
                }

                // Check if any pattern matches
                const matchTarget = `${quota.id} ${quota.providerName}`;
                const patternMatches = group.patterns.some(pattern => {
                    const res = this.matchPattern(pattern, matchTarget);
                    return res.matched;
                });

                if (patternMatches) {
                    matched.push(quota);
                    matchedIds.add(quota.id);
                }
            }
        }

        return matched;
    }

    private filterQuotas(quotas: QuotaData[], context?: { providerId?: string; modelId?: string }): QuotaData[] {
        let results = [...quotas];
        const showStatusRows = process.env.OPENCODE_QUOTAS_SHOW_STATUS === "1";

        if (!showStatusRows) {
            results = results.filter((data) => data.unit !== "status");
        }

        // Filter out disabled quotas
        const disabledIds = new Set(this.config.disabled || []);
        results = results.filter((data) => !disabledIds.has(data.id));

        // If requested, apply model-aware filtering
        if (this.config.filterByCurrentModel && context && context.providerId && context.modelId) {
            return this.filterByModel(results, context.providerId, context.modelId);
        }

        return results;
    }

    private filterByModel(quotas: QuotaData[], providerId: string, modelId: string): QuotaData[] {
        const providerLower = providerId.toLowerCase();
        const modelIdLower = modelId.toLowerCase();

        // Fuzzy token match with scoring
        const tokens = modelIdLower.split(/[^a-z0-9]+/).filter(Boolean);
        const scoredMatches = quotas
            .map(q => {
                const id = q.id.toLowerCase();
                const name = q.providerName.toLowerCase();
                const score = tokens.reduce((acc, t) => acc + (id.includes(t) || name.includes(t) ? 1 : 0), 0);
                return { q, score };
            })
            .filter(m => m.score > 0)
            .sort((a, b) => b.score - a.score);

        if (scoredMatches.length > 0) {
            const maxScore = scoredMatches[0].score;
            return scoredMatches.filter(m => m.score === maxScore).map(m => m.q);
        }

        // 3) Provider fallback
        const matchesProvider = quotas.filter(q => 
            q.providerName.toLowerCase().includes(providerLower)
        );
        return matchesProvider.length > 0 ? matchesProvider : [];
    }

    private sortQuotas(quotas: QuotaData[]): QuotaData[] {
        return quotas.sort((a, b) => a.providerName.localeCompare(b.providerName));
    }
}
