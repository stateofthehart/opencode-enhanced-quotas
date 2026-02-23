import { type IQuotaProvider, type QuotaData, type IHistoryService } from "./interfaces.js";
import { validateQuotaData } from "./utils/validation.js";
import { fetchQuotasFromGateway } from "./gateway-client.js";

import { logger } from "./logger.js";

type CachedQuotas = {
    data: QuotaData[];
    fetchedAt: Date | null;
    lastError: unknown;
};

type QuotaCacheOptions = {
    refreshIntervalMs: number;
    historyService?: IHistoryService;
    debug?: boolean;
    gatewayUrl?: string;
};

const DEFAULT_OPTIONS: QuotaCacheOptions = {
    refreshIntervalMs: 60_000,
};

export class QuotaCache {
    private readonly providers: IQuotaProvider[];
    private readonly options: QuotaCacheOptions;
    private state: CachedQuotas;
    private timer: ReturnType<typeof setInterval> | null;
    private inFlight: Promise<void> | null;

    public constructor(providers: IQuotaProvider[], options?: Partial<QuotaCacheOptions>) {
        this.providers = providers;
        this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
        this.state = { data: [], fetchedAt: null, lastError: null };
        this.timer = null;
        this.inFlight = null;
    }

    public start(): void {
        if (this.timer) return;

        // Kick off an initial refresh without blocking startup.
        void this.refresh();

        this.timer = setInterval(() => {
            void this.refresh();
        }, this.options.refreshIntervalMs);

        // Avoid keeping the process alive just for quota polling.
        this.timer.unref?.();
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    public getSnapshot(): CachedQuotas {
        return this.state;
    }

    public async refresh(): Promise<void> {
        logger.debug(
            "cache:refresh_start",
            {
                providerCount: this.providers.length,
                refreshIntervalMs: this.options.refreshIntervalMs,
                inFlight: !!this.inFlight,
            },
        );
        if (this.inFlight) {
            logger.debug("cache:refresh_coalesced", { inFlight: true });
            return this.inFlight;
        }

        const refreshPromise = this.doRefresh();
        this.inFlight = refreshPromise;

        return refreshPromise;
    }


    private async doRefresh(): Promise<void> {
        try {
            let validatedData: QuotaData[];
            
            // Use gateway if configured
            if (this.options.gatewayUrl) {
                logger.debug("cache:using_gateway", { url: this.options.gatewayUrl });
                const quotas = await fetchQuotasFromGateway(this.options.gatewayUrl);
                validatedData = quotas
                    .map(d => validateQuotaData(d))
                    .filter((v): v is QuotaData => v !== null);
            } else {
                // Fetch from individual providers
                const results = await Promise.all(
                    this.providers.map(async (p: IQuotaProvider) => {
                        const startedAt = Date.now();
                        try {
                            logger.debug(
                                "cache:provider_fetch_start",
                                { id: p.id },
                            );
                            const result = await p.fetchQuota();
                            logger.debug(
                                "cache:provider_fetch_ok",
                                {
                                    id: p.id,
                                    count: result.length,
                                    durationMs: Date.now() - startedAt,
                                },
                            );
                            return result;
                        } catch (e) {
                            logger.error(
                                "cache:provider_fetch_error",
                                {
                                    id: p.id,
                                    durationMs: Date.now() - startedAt,
                                    error: e,
                                },
                            );
                            return [];
                        }
                    }),
                );

                // Validate and normalize provider responses before storing
                const flattened = results.flat();
                validatedData = flattened
                    .map(d => validateQuotaData(d))
                    .filter((v): v is QuotaData => v !== null);
            }

            this.state = {
                data: validatedData,
                fetchedAt: new Date(),
                lastError: null,
            };

            logger.debug(
                "cache:refresh_ok",
                {
                    totalCount: this.state.data.length,
                    fetchedAt: this.state.fetchedAt?.toISOString(),
                },
            );

            if (this.options.historyService) {
                void this.options.historyService.append(this.state.data);
            }
        } catch (e) {
            this.state = {
                ...this.state,
                lastError: e,
            };
            logger.error(
                "cache:refresh_error",
                { error: e },
            );
        } finally {
            logger.debug(
                "cache:refresh_end",
                { inFlightCleared: true },
            );
            this.inFlight = null;
        }
    }
}
