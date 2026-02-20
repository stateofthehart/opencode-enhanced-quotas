export interface QuotaData {
    id: string; // Unique identifier (e.g., "codex-primary", "ag-flash")
    providerName: string; // Display name
    used: number;
    limit: number | null;
    unit: string;

    /**
     * Reset time description (e.g. "in 2h 41m" or "at 12:00").
     */
    reset?: string;

    /**
     * Predicted time until limit is reached (e.g. "in 12m (predicted)").
     */
    predictedReset?: string;

    /**
     * Window or period description (e.g. "5h window" or "Monthly").
     */
    window?: string;

    /**
     * Extra information or alerts (e.g. "!!" or "unlimited").
     */
    info?: string;

    /**
     * @deprecated Use reset, window, info instead.
     */
    details?: string;
}

export type QuotaColumn =
    | "name"
    | "bar"
    | "percent"
    | "value"
    | "reset"
    | "window"
    | "info"
    | "status"
    | "ettl";

export interface QuotaConfig {
    displayMode: QuotaDisplayMode;
    progressBar?: ProgressBarConfig;
    table?: {
        /**
         * Columns to display in the quota table.
         * Defaults to a smart selection based on data.
         */
        columns?: QuotaColumn[];
        /**
         * Whether to render the table header row (column labels)
         */
        header?: boolean;
    };
    /**
     * Whether to show quotas in the chat footer automatically.
     * Defaults to true.
     */
    footer?: boolean;
    /**
     * Whether to show the plugin title/header (bold line) in the footer.
     * Defaults to true.
     */
    showFooterTitle?: boolean;
    /**
     * List of quota IDs to hide from display.
     */
    disabled?: string[];
    /**
     * Only show quotas relevant to the current model (best-effort matching).
     */
    filterByCurrentModel?: boolean;
    /**
     * Enable debug logging to ~/.local/share/opencode/quotas-debug.log
     */
    debug?: boolean;
    enableExperimentalGithub?: boolean;
    /**
     * Optional aggregation groups.
     */
    aggregatedGroups?: AggregatedGroup[];
    /**
     * Max history age in hours. Defaults to 24.
     */
    historyMaxAgeHours?: number;
    /**
     * Polling interval in milliseconds. Defaults to 60000 (1 minute).
     */
    pollingInterval?: number;
    /**
     * Short time window for regression to capture spikes (minutes). Defaults to 5.
     */
    predictionShortWindowMinutes?: number;
    /**
     * Time window for regression analysis (minutes). Defaults to 60.
     */
    predictionWindowMinutes?: number;
    /**
     * Whether to show quotas that did not match any aggregation group.
     * Defaults to false.
     */
    showUnaggregated?: boolean;
    /**
     * Threshold for detecting a quota reset (0-100).
     * Defaults to 20.
     */
    historyResetThreshold?: number;
}

export type AggregationStrategy =
    | "most_critical" // Predicted time-to-limit (requires history)
    | "min" // Lowest percentage used
    | "max" // Highest percentage used
    | "mean" // Average percentage used
    | "median"; // Median percentage used

export interface AggregatedGroup {
    /**
     * Unique ID for the resulting group (e.g., "ag-flash", "codex-smart").
     */
    id: string;
    /**
     * Display name (e.g., "Antigravity Flash", "Codex Usage").
     */
    name: string;
    /**
     * Explicit IDs of quotas to include in this group.
     * Use this for precise control over which quotas are aggregated.
     */
    sources?: string[];
    /**
     * Regex/Glob patterns to match against raw quota IDs or provider names.
     * The provider will return raw quotas with IDs like "ag-raw-gemini-1-5-flash".
     * Patterns are matched case-insensitively.
     */
    patterns?: string[];
    /**
     * Optional: Limit pattern matching to a specific provider ID.
     * If set, only quotas from this provider will be considered for pattern matching.
     */
    providerId?: string;
    /**
     * Aggregation strategy. Defaults to "most_critical".
     */
    strategy?: AggregationStrategy;
    /**
     * Time window for regression (default: 60 minutes).
     */
    predictionWindowMinutes?: number;
    /**
     * Short time window for spikes (default: 5 minutes).
     */
    predictionShortWindowMinutes?: number;
}

export interface HistoryPoint {
    timestamp: number;
    used: number;
    limit: number | null;
}

export interface IHistoryService {
    init(): Promise<void>;
    append(snapshot: QuotaData[]): Promise<void>;
    getHistory(quotaId: string, windowMs: number): HistoryPoint[];
    setMaxAge(hours: number): void;
    setResetThreshold(percent: number): void;
    pruneAll(): Promise<void>;
}

export interface IQuotaProvider {
    id: string;
    fetchQuota(): Promise<QuotaData[]>;
}

export interface IQuotaRegistry {
    register(provider: IQuotaProvider): void;
    getAll(): IQuotaProvider[];
}

/**
 * Interface for prediction engines that calculate time-to-limit.
 */
export interface IPredictionEngine {
    /**
     * Predicts time to limit in milliseconds using historical usage data.
     * @param quotaId - The quota identifier to predict for
     * @param windowMinutes - The long time window for regression (default: 60)
     * @param shortWindowMinutes - The short time window for capturing spikes
     * @returns Time to limit in milliseconds, or Infinity if usage is stable/decreasing
     */
    predictTimeToLimit(
        quotaId: string,
        windowMinutes?: number,
        shortWindowMinutes?: number,
        context?: { windowInfo?: string }
    ): number;
}

/**
 * Interface for aggregation services that combine multiple quotas.
 */
export interface IAggregationService {
    /**
     * Aggregates quotas using the most critical (shortest time-to-limit) strategy.
     */
    aggregateMostCritical(
        quotas: QuotaData[],
        windowMinutes?: number,
        shortWindowMinutes?: number,
    ): QuotaData | null;

    /**
     * Aggregates quotas by selecting the one with highest usage ratio.
     */
    aggregateMax(quotas: QuotaData[]): QuotaData;

    /**
     * Aggregates quotas by selecting the one with lowest usage ratio.
     */
    aggregateMin(quotas: QuotaData[]): QuotaData;

    /**
     * Aggregates quotas by averaging their usage ratios.
     */
    aggregateAverage(
        quotas: QuotaData[],
        name: string,
        id: string,
        strategy: "mean" | "median",
    ): QuotaData;
}

export type QuotaDisplayMode = "simple" | "detailed" | "hidden";

export type AnsiColor =
    | "red"
    | "green"
    | "yellow"
    | "blue"
    | "magenta"
    | "cyan"
    | "white"
    | "gray"
    | "bold"
    | "dim"
    | "reset";

export interface GradientLevel {
    threshold: number; // 0 to 1 (e.g., 0.8 for 80%)
    color: AnsiColor;
}

export interface ProgressBarConfig {
    width?: number;
    filledChar?: string;
    emptyChar?: string;
    show?: "used" | "available";
    /**
     * Enable ANSI colors. Defaults to false.
     */
    color?: boolean;
    // Define color levels. The bar will use the color of the first level
    // whose threshold is greater than or equal to the current usage ratio.
    gradients?: GradientLevel[];
}

// ============================================
// Phase 1: Active Probe & Health Monitoring
// ============================================

export type QuotaErrorType =
    | "rate_limited"
    | "no_credits"
    | "auth_expired"
    | "auth_invalid"
    | "model_unavailable"
    | "endpoint_down"
    | "billing"
    | "unknown";

export interface QuotaError {
    type: QuotaErrorType;
    provider: string;
    message?: string;
    resetAt?: Date;
    retryAfter?: number;
    fundBalance?: number;
    model?: string;
    alternatives?: string[];
    lastSeen?: Date;
}

export interface ProbeResult {
    provider: string;
    model: string;
    available: boolean;
    latencyMs: number;
    rateLimitRemaining?: number;
    rateLimitLimit?: number;
    rateLimitReset?: Date;
    error?: QuotaError;
    timestamp: Date;
    headers?: Record<string, string>;
}

export interface ProbeConfig {
    timeout?: number;
    prompt?: string;
    maxTokens?: number;
    maxModelsPerProvider?: number;
}

export interface ProviderHealth {
    provider: string;
    status: "healthy" | "degraded" | "down" | "unknown";
    lastProbe?: Date;
    lastSuccess?: Date;
    latencyMs?: number;
    avgLatencyMs?: number;
    errorRate: number;
    consecutiveFailures: number;
    totalProbes: number;
    successfulProbes: number;
    lastError?: QuotaError;
    rateLimitRemaining?: number;
    rateLimitReset?: Date;
}

export interface IProber {
    probe(provider: string, model?: string, config?: ProbeConfig): Promise<ProbeResult>;
    probeAll(config?: ProbeConfig): Promise<ProbeResult[]>;
    probeAllModels(config?: ProbeConfig): Promise<ProbeResult[]>;
}

export interface IHealthMonitor {
    recordProbe(result: ProbeResult): void;
    getHealth(provider: string): ProviderHealth;
    getAllHealth(): ProviderHealth[];
    getAvailableProviders(): string[];
    getCacheAge(provider: string): number;
}

export type TelemetryType = "authoritative" | "header-based" | "status-only";

export type RateLimitType = "provider_wide" | "per_model" | "provider_model_specific";

export interface ProviderCapability {
    id: string;
    name: string;
    telemetryType: TelemetryType;
    supportsProbe: boolean;
    probeModel?: string;
    probeEndpoint?: string;
    requiresAuth: boolean;
    isFreeTier: boolean;
    isPayAsYouGo: boolean;
    isSubscription: boolean;
    minimumDeposit?: number;
    depositCurrency?: string;
    freeCredits?: number;
    rateLimitType?: RateLimitType;
    notes?: string;
}

// ============================================
// Phase 1.5: Model Discovery & Balance
// ============================================

export interface ModelInfo {
    id: string;
    name?: string;
    provider: string;
    contextWindow?: number;
    pricing?: {
        prompt: number;
        completion: number;
        currency?: string;
    };
    isFree: boolean;
    isAvailable: boolean;
    capabilities?: string[];
}

export interface DiscoveredModel extends ModelInfo {
    discoveredAt: Date;
    lastChecked: Date;
    error?: string;
}

export interface ProviderModelList {
    provider: string;
    models: DiscoveredModel[];
    fetchedAt: Date;
    error?: string;
}

export interface BalanceInfo {
    provider: string;
    credits?: number;
    creditsUsd?: number;
    freeTierRemaining?: number;
    isPayAsYouGo: boolean;
    isSubscription: boolean;
    minimumDeposit?: number;
    lastUpdated: Date;
}

export interface IModelDiscovery {
    discoverModels(provider: string): Promise<ProviderModelList>;
    discoverAll(): Promise<ProviderModelList[]>;
    getFreeModels(provider: string): Promise<DiscoveredModel[]>;
    getAvailableModels(provider: string, minBalance?: number): Promise<DiscoveredModel[]>;
}

export interface IBalanceChecker {
    checkBalance(provider: string): Promise<BalanceInfo | null>;
    checkAllBalances(): Promise<BalanceInfo[]>;
}

export interface ProviderDiscoveryConfig {
    id: string;
    name: string;
    modelsEndpoint?: string;
    defaultModels?: string[];
    balanceEndpoint?: string;
    rateLimitType: RateLimitType;
    hasFreeTier: boolean;
    minimumDeposit?: number;
    freeModelFilter?: (model: Record<string, unknown>) => boolean;
    modelIdField?: string;
    pricingField?: string;
    accountIdField?: string;
}

// Model state tracking for timeout and cooldown awareness
export interface ModelState {
    provider: string;
    modelId: string;
    isAvailable: boolean;
    lastChecked: Date;
    lastSuccess?: Date;
    lastError?: Date;
    errorCount: number;
    consecutiveFailures: number;
    isRateLimited: boolean;
    rateLimitReset?: Date;
    isFreeTier: boolean;
    estimatedCostPerRequest?: number;
    avgLatencyMs?: number;
    timeoutCount: number;
    isDead?: boolean;              // Permanently retired/unavailable
    deadReason?: string;           // Why it's dead (e.g., "retired", "deprecated")
    deadSince?: Date;              // When it was marked as dead
}

export interface ModelFilterOptions {
    onlyAvailable?: boolean;
    onlyFree?: boolean;
    minBalance?: number;
    maxLatency?: number;
    excludeRateLimited?: boolean;
    excludeTimeouts?: boolean;
    excludeDead?: boolean;           // Exclude permanently retired/dead models
    excludeCircuitOpen?: boolean;     // Exclude models with open circuit breakers
}

export interface IModelStateTracker {
    updateModelState(state: ModelState): Promise<void>;
    getModelState(provider: string, modelId: string): Promise<ModelState | null>;
    getAllModelStates(filter?: ModelFilterOptions): Promise<ModelState[]>;
    getAvailableModels(filter?: ModelFilterOptions): Promise<ModelState[]>;
    markModelTimeout(provider: string, modelId: string): Promise<void>;
    markModelRateLimited(provider: string, modelId: string, resetAt?: Date): Promise<void>;
    markModelSuccess(provider: string, modelId: string, latencyMs: number): Promise<void>;
    markModelFailure(provider: string, modelId: string, error?: string): Promise<void>;
    markModelDead(provider: string, modelId: string, reason?: string): Promise<void>;
    clearOldStates(olderThan: Date): Promise<void>;
    // Aliases for backward compatibility
    recordSuccess(provider: string, modelId: string, latencyMs: number): Promise<void>;
    recordError(provider: string, modelId: string, error: string): Promise<void>;
}

// === OpenAI-compatible API Types ===

export interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
    function_call?: {
        name: string;
        arguments: string;
    };
}

export interface ChatCompletionRequest {
    model: string;
    messages: ChatCompletionMessage[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    n?: number;
    stream?: boolean;
    stop?: string | string[];
    presence_penalty?: number;
    frequency_penalty?: number;
    logit_bias?: Record<string, number>;
    user?: string;
}

export interface ChatCompletionChoice {
    index: number;
    message: ChatCompletionMessage;
    finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter' | null;
}

export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: ChatCompletionChoice[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface ModelListResponse {
    object: 'list';
    data: {
        id: string;
        object: 'model';
        created: number;
        owned_by: string;
        permission: any[];
        root: string;
        parent: string | null;
    }[];
}
