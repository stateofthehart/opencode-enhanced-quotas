import { type Plugin, type Hooks } from "@opencode-ai/plugin";
import { type AssistantMessage, type UserMessage } from "@opencode-ai/sdk";
import { readFile } from "node:fs/promises";
import { QuotaService } from "./services/quota-service.js";
import { HistoryService } from "./services/history-service.js";
import { renderQuotaTable } from "./ui/quota-table.js";
import { type QuotaData } from "./interfaces.js";
import { QuotaCache } from "./quota-cache.js";
import {
    PLUGIN_FOOTER_SIGNATURE,
    SKIP_REASONS,
} from "./constants.js";
import { logger } from "./logger.js";
import { getPluginState } from "./plugin-state.js";
import { DEBUG_LOG_FILE } from "./utils/paths.js";

/**
 * Extended message type with additional fields that may be present at runtime.
 * Uses Omit to override required fields that we know may be optional.
 */
type ExtendedAssistantMessage = Omit<AssistantMessage, "parentID"> & {
    type?: string;
    mode?: string;
    agent?: string;
    finish?: string;
    parentID?: string;
    modelID?: string;
    providerID?: string;
    tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
    };
};

type TextPart = {
    id: string;
    type: "text";
    text: string;
    ignored?: boolean;
    sessionID?: string;
    messageID?: string;
    synthetic?: boolean;
    time?: {
        start: number;
        end?: number;
    };
    metadata?: Record<string, unknown>;
};

/**
 * QuotaHub Plugin for OpenCode.ai
 */
export const QuotaHubPlugin: Plugin = async ({
    client,
    $,
    directory,
    serverUrl,
}) => {
    const state = getPluginState();
    const historyService = new HistoryService();
    const quotaService = new QuotaService();

    let quotaCache: QuotaCache | undefined;
    let initPromise: Promise<void> | undefined;

    const MAX_INIT_RETRIES = 3;
    const INITIAL_RETRY_DELAY_MS = 2000;

    // Dedicated initialization function
    const ensureInit = async (): Promise<void> => {
        if (initPromise) return initPromise;

        initPromise = (async () => {
            let lastError: unknown;
            for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
                try {
                    await historyService.init();
                    await quotaService.init(directory, historyService);

                    const config = quotaService.getConfig();
                    const providers = quotaService.getProviders();
                    logger.debug("init:providers", {
                        ids: providers.map((p) => p.id),
                        count: providers.length,
                    });
                    quotaCache = new QuotaCache(providers, {
                        refreshIntervalMs: config.pollingInterval ?? 60_000,
                        historyService,
                        debug: !!config.debug,
                    });
                    quotaCache.start();
                    logger.debug("init:complete");
                    return; // Success
                } catch (e) {
                    lastError = e;
                    const errorMsg = e instanceof Error ? e.message : String(e);

                    if (attempt < MAX_INIT_RETRIES) {
                        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                        logger.warn("init:failed_retry", {
                            attempt,
                            delayMs: delay,
                            error: errorMsg,
                        });
                        await new Promise((resolve) => setTimeout(resolve, delay));
                    } else {
                        logger.error("init:failed_final", {
                            attempt,
                            error: errorMsg,
                        });
                        logger.warn("init:failed_visible", {
                            message: `Failed to initialize after ${MAX_INIT_RETRIES} attempts. Quota information will be unavailable.`,
                        });
                    }
                }
            }
            throw lastError;
        })();

        return initPromise;
    };

    // Trigger background initialization
    ensureInit().catch(() => {
        // Warning already logged in ensureInit if it failed after max retries
    });

    const makeDebugLog = (config: ReturnType<typeof quotaService.getConfig>) => {
        return (msg: string, data?: any) => {
            if (config.debug) logger.debug(msg, data);
        };
    };

    const readRecentDebugLogs = async (maxLines: number = 120): Promise<string> => {
        try {
            const raw = await readFile(DEBUG_LOG_FILE(), "utf-8");
            const lines = raw.split(/\r?\n/).filter(Boolean);
            if (lines.length === 0) return "No debug logs found.";
            const recent = lines.slice(Math.max(0, lines.length - maxLines));
            return recent.join("\n");
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Unable to read debug log (${DEBUG_LOG_FILE()}): ${msg}`;
        }
    };

    const buildFooterText = (
        assistantMsg: ExtendedAssistantMessage,
        config: ReturnType<typeof quotaService.getConfig>,
        cache: QuotaCache,
        debugLog: (msg: string, data?: any) => void,
    ): { text: string; lineCount: number } | null => {
        const snapshot = cache.getSnapshot();
        const rawResults: QuotaData[] = snapshot.data;
        debugLog("cache:snapshot", {
            fetchedAt: snapshot.fetchedAt?.toISOString(),
            totalCount: rawResults.length,
            hasError: !!snapshot.lastError,
        });
        if (rawResults.length === 0) {
            debugLog("skip:no_cached_quotas", {
                fetchedAt: snapshot.fetchedAt?.toISOString(),
                lastError: snapshot.lastError,
            });
            return null;
        }

        const filteredResults = quotaService.processQuotas(rawResults, {
            providerId: assistantMsg.providerID,
            modelId: assistantMsg.modelID,
        });

        debugLog("quotas:processed", {
            before: rawResults.length,
            after: filteredResults.length,
            providerId: assistantMsg.providerID,
            modelId: assistantMsg.modelID,
        });

        if (filteredResults.length === 0) {
            debugLog("skip:all_quotas_filtered", {
                providerId: assistantMsg.providerID,
                modelId: assistantMsg.modelID,
            });
            return null;
        }

        const lines = renderQuotaTable(filteredResults, {
            progressBarConfig: config.progressBar,
            tableConfig: config.table,
        }).map((l) => l.line);

        const showMode = config.progressBar?.show ?? "used";
        const modeLabel = showMode === "available" ? "(Remaining)" : "(Used)";
        const showTitle = config.showFooterTitle !== false;
        const titleText = showTitle
            ? `${PLUGIN_FOOTER_SIGNATURE} ${modeLabel}_\n`
            : "";

        return {
            text: "\n\n" + titleText + lines.join("\n"),
            lineCount: lines.length,
        };
    };

    const hooks: Hooks = {
        config: async (config) => {
            if (!config.command) {
                config.command = {};
            }
            config.command["usage"] = {
                template: "/usage",
                description: "Show current quota usage for all providers",
            };
            config.command["mymodels"] = {
                template: "/mymodels",
                description: "Show quota usage filtered by current model",
            };
            config.command["usage-logs"] = {
                template: "/usage-logs",
                description: "Show recent quota plugin debug logs",
            };
        },

        "command.execute.before": async (input) => {
            if (input.command === "usage-logs") {
                const logs = await readRecentDebugLogs();
                await client.session.prompt({
                    path: { id: input.sessionID },
                    body: {
                        noReply: true,
                        parts: [
                            {
                                type: "text",
                                text: `\nQuota Plugin Logs (${DEBUG_LOG_FILE()}):\n\n${logs}\n`,
                                ignored: true,
                            },
                        ],
                    },
                });
                throw new Error("COMMAND_HANDLED");
            }

            if (input.command === "usage" || input.command === "mymodels") {
                await ensureInit();
                const config = quotaService.getConfig();
                
                // Fetch fresh quotas on command (or use cache if desired, but fresh is better for explicit command)
                // We'll use the service's getQuotas which uses providers directly, bypassing the cache loop for freshness
                // unless we want strictly cached data. Let's force a fetch.
                const results = await quotaService.getQuotas();
                
                const filteredResults = input.command === "mymodels"
                    ? quotaService.processQuotas(results, { 
                        // We might not have context here easily, but we can try to get it from last message
                        // For now, "mymodels" might behave same as usage if we can't get context
                      })
                    : quotaService.processQuotas(results);

                const lines = renderQuotaTable(filteredResults, {
                    progressBarConfig: config.progressBar,
                    tableConfig: config.table,
                }).map((l) => l.line);

                const outputText = lines.length > 0 
                    ? `\n${lines.join("\n")}\n` 
                    : "\nNo quota information available.\n";

                // Send response to user
                await client.session.prompt({
                    path: { id: input.sessionID },
                    body: {
                        noReply: true,
                        parts: [
                            {
                                type: "text",
                                text: outputText,
                                ignored: true,
                            },
                        ],
                    },
                });

                // Stop further execution
                throw new Error("COMMAND_HANDLED");
            }
        },

        /**
         * The platform calls this hook after a text generation is complete.
         * We inject the quota footer directly into output.text for final assistant messages.
         */
        "experimental.text.complete": async (
            input: {
                sessionID: string;
                messageID: string;
                partID: string;
            },
            output: {
                text: string;
            },
        ): Promise<void> => {
            // Ensure initialization is complete before processing
            await ensureInit().catch((e) => {
                logger.error("init:error", { error: e });
            });
            if (!quotaCache) {
                const config = quotaService.getConfig();
                if (config.debug)
                    logger.debug("hook:no_cache", {
                        messageID: input.messageID,
                    });
                return;
            }

            const cache = quotaCache;
            const config = quotaService.getConfig();
            const debugLog = makeDebugLog(config);

            if (config.footer === false) {
                debugLog("skip:footer_disabled", {
                    messageID: input.messageID,
                });
                return;
            }

            // Log hook invocation
            debugLog("hook:experimental.text.complete", {
                input,
                processed: state.isProcessed(input.messageID),
                pending: state.isPending(input.messageID),
            });

            // Fast path check
            if (state.isProcessed(input.messageID)) {
                debugLog("skip:already_processed", {
                    messageID: input.messageID,
                });
                return;
            }

            if (state.isPending(input.messageID)) {
                debugLog("skip:already_pending", {
                    messageID: input.messageID,
                });
                return;
            }

            // Secondary safeguard: check if footer already present
            if (output.text.includes(PLUGIN_FOOTER_SIGNATURE)) {
                debugLog(SKIP_REASONS.FOOTER_PRESENT, {
                    messageID: input.messageID,
                });
                state.markProcessed(input.messageID);
                return;
            }

            debugLog("lock:acquire_start", { messageID: input.messageID });
            // Acquire lock for this message
            const release = await state.acquireLock(input.messageID);
            debugLog("lock:acquired", { messageID: input.messageID });

            try {
                // After acquiring lock, re-check if processed
                if (state.isProcessed(input.messageID)) {
                    debugLog("skip:already_processed_after_lock", {
                        messageID: input.messageID,
                    });
                    return;
                }

                if (state.isPending(input.messageID)) {
                    debugLog("skip:already_pending_after_lock", {
                        messageID: input.messageID,
                    });
                    return;
                }

                // Double-check text content in case another process injected it while we waited for lock
                if (output.text.includes(PLUGIN_FOOTER_SIGNATURE)) {
                    debugLog("skip:footer_present_after_lock", {
                        messageID: input.messageID,
                    });
                    state.markProcessed(input.messageID);
                    return;
                }

                // Fetch message to verify role and parts
                const { data: result } = await client.session.message({
                    path: {
                        id: input.sessionID,
                        messageID: input.messageID,
                    },
                });

                if (!result || result.info.role !== "assistant") {
                    debugLog("skip:not_assistant", {
                        messageID: input.messageID,
                        role: result?.info?.role,
                    });
                    state.markProcessed(input.messageID);
                    return;
                }

                const assistantMsg = result.info as ExtendedAssistantMessage;
                const parts = result.parts || [];
                const currentPartIndex = parts.findIndex((p) => p.id === input.partID);
                const currentPart = parts[currentPartIndex] as { type?: string } | undefined;
                
                // Simplified completion check: Is this the last part of the message?
                const isLastPart = currentPartIndex === parts.length - 1;

                debugLog("message:details", {
                    id: input.messageID,
                    mode: assistantMsg.mode,
                    agent: assistantMsg.agent,
                    partID: input.partID,
                    partType: currentPart?.type,
                    isLastPart,
                    totalParts: parts.length
                });

                const isSubagentMessage = assistantMsg.mode === "subagent";
                const isReasoningPart = currentPart?.type === "reasoning";
                const hasReasoningType =
                    assistantMsg.mode === "reasoning" ||
                    assistantMsg.type === "reasoning";

                const isThinking =
                    isSubagentMessage || isReasoningPart || hasReasoningType;

                if (isThinking) {
                    debugLog(SKIP_REASONS.THINKING, {
                        messageID: input.messageID,
                        partID: input.partID,
                        type: currentPart?.type
                    });
                    return;
                }

                // Only inject on the last part of the message to avoid double injection
                // and to ensure we are at the very end.
                if (!isLastPart) {
                    debugLog("skip:not_last_part", {
                        messageID: input.messageID,
                        partID: input.partID,
                        index: currentPartIndex,
                        total: parts.length
                    });
                    return;
                }

                // Verify it's a text part (we don't want to inject into tool calls or others)
                if (currentPart?.type !== "text") {
                    debugLog("skip:not_text_part", {
                        messageID: input.messageID,
                        partID: input.partID,
                        type: currentPart?.type
                    });
                    state.markProcessed(input.messageID);
                    return;
                }

                // Build footer and inject directly into output.text
                const footer = buildFooterText(
                    assistantMsg,
                    config,
                    cache,
                    debugLog,
                );

                if (!footer) {
                    state.markProcessed(input.messageID);
                    return;
                }

                // Inline injection: modify output.text directly
                output.text = output.text + footer.text;
                state.markProcessed(input.messageID);
                debugLog("inject:footer_inline", {
                    messageID: input.messageID,
                    lines: footer.lineCount,
                });
            } finally {
                debugLog("lock:release", { messageID: input.messageID });
                release();
            }
        },
    };

    return hooks;
};

export default QuotaHubPlugin;
