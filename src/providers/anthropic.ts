import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { type IQuotaProvider, type QuotaData } from "../interfaces.js";
import { logger } from "../logger.js";

/**
 * Claude OAuth usage provider.
 *
 * Reads the OAuth access token from ~/.claude/.credentials.json (claudeAiOauth)
 * and calls GET https://api.anthropic.com/api/oauth/usage with the Bearer token
 * and anthropic-beta header to get 5-hour session and 7-day rolling usage.
 */

const CLAUDE_CREDS_FILE = () => join(homedir(), ".claude", ".credentials.json");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

interface ClaudeCredentials {
    claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        scopes?: string[];
        subscriptionType?: string;
        rateLimitTier?: string;
    };
}

interface UsageWindow {
    utilization: number | null;
    resets_at: string | null;
}

interface ClaudeUsageResponse {
    five_hour?: UsageWindow;
    seven_day?: UsageWindow;
    seven_day_sonnet?: UsageWindow | null;
    seven_day_opus?: UsageWindow | null;
    seven_day_cowork?: UsageWindow | null;
    extra_usage?: {
        is_enabled?: boolean;
        monthly_limit?: number | null;
        used_credits?: number | null;
    };
}

async function readAccessToken(): Promise<string | null> {
    try {
        const raw = await readFile(CLAUDE_CREDS_FILE(), "utf-8");
        const creds: ClaudeCredentials = JSON.parse(raw);
        return creds.claudeAiOauth?.accessToken ?? null;
    } catch (e) {
        logger.debug("anthropic:read_creds_failed", { error: e });
        return null;
    }
}

function formatResetTime(isoString: string | null | undefined): string | undefined {
    if (!isoString) return undefined;
    try {
        const resetDate = new Date(isoString);
        const now = Date.now();
        const diffMs = resetDate.getTime() - now;
        if (diffMs <= 0) return "now";
        const hours = Math.floor(diffMs / 3_600_000);
        const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            return `${days}d ${remHours}h`;
        }
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    } catch {
        return undefined;
    }
}

function extractQuotas(data: ClaudeUsageResponse): QuotaData[] {
    const quotas: QuotaData[] = [];

    // 5-hour session window
    if (data.five_hour) {
        const util = data.five_hour.utilization ?? 0;
        quotas.push({
            id: "claude-5h",
            providerName: "Claude 5h Session",
            used: util,
            limit: 100,
            unit: "%",
            window: "5h window",
            reset: formatResetTime(data.five_hour.resets_at),
        });
    }

    // 7-day rolling window
    if (data.seven_day) {
        const util = data.seven_day.utilization ?? 0;
        quotas.push({
            id: "claude-7d",
            providerName: "Claude 7d Rolling",
            used: util,
            limit: 100,
            unit: "%",
            window: "7d window",
            reset: formatResetTime(data.seven_day.resets_at),
        });
    }

    // Optional per-model windows
    if (data.seven_day_sonnet && data.seven_day_sonnet.utilization != null) {
        quotas.push({
            id: "claude-7d-sonnet",
            providerName: "Claude 7d Sonnet",
            used: data.seven_day_sonnet.utilization,
            limit: 100,
            unit: "%",
            window: "7d window",
            reset: formatResetTime(data.seven_day_sonnet.resets_at),
        });
    }

    if (data.seven_day_opus && data.seven_day_opus.utilization != null) {
        quotas.push({
            id: "claude-7d-opus",
            providerName: "Claude 7d Opus",
            used: data.seven_day_opus.utilization,
            limit: 100,
            unit: "%",
            window: "7d window",
            reset: formatResetTime(data.seven_day_opus.resets_at),
        });
    }

    if (data.seven_day_cowork && data.seven_day_cowork.utilization != null) {
        quotas.push({
            id: "claude-7d-cowork",
            providerName: "Claude 7d Cowork",
            used: data.seven_day_cowork.utilization,
            limit: 100,
            unit: "%",
            window: "7d window",
            reset: formatResetTime(data.seven_day_cowork.resets_at),
        });
    }

    // Extra usage / credits
    if (data.extra_usage?.is_enabled && data.extra_usage.monthly_limit != null) {
        const used = data.extra_usage.used_credits ?? 0;
        quotas.push({
            id: "claude-extra",
            providerName: "Claude Extra Credits",
            used,
            limit: data.extra_usage.monthly_limit,
            unit: "credits",
            info: "monthly extra usage",
        });
    }

    return quotas;
}

export function createAnthropicProvider(): IQuotaProvider {
    return {
        id: "anthropic",
        async fetchQuota(): Promise<QuotaData[]> {
            const token = await readAccessToken();
            if (!token) {
                logger.debug("anthropic:no_token", {});
                return [];
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);

            try {
                logger.debug("anthropic:fetch_start", { url: USAGE_URL });

                const res = await fetch(USAGE_URL, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "anthropic-beta": "oauth-2025-04-20",
                    },
                    signal: controller.signal,
                });

                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    logger.debug("anthropic:fetch_error", {
                        status: res.status,
                        body: body.slice(0, 200),
                    });
                    return [];
                }

                const data: ClaudeUsageResponse = await res.json();
                logger.debug("anthropic:fetch_ok", { data });

                return extractQuotas(data);
            } catch (e: any) {
                if (e?.name === "AbortError") {
                    logger.debug("anthropic:timeout", {});
                } else {
                    logger.debug("anthropic:fetch_exception", { error: e });
                }
                return [];
            } finally {
                clearTimeout(timeout);
            }
        },
    };
}
