import { readFile } from "node:fs/promises";
import { type IQuotaProvider, type QuotaData } from "../interfaces.js";
import { AUTH_FILE } from "../utils/paths.js";
import { logger } from "../logger.js";

/**
 * GitHub Copilot usage provider.
 *
 * Reads the github-copilot OAuth token from OpenCode's auth.json
 * and calls GET https://api.github.com/copilot_internal/user
 * to get premium interactions, chat, and completions quotas.
 */

const COPILOT_URL = "https://api.github.com/copilot_internal/user";

interface AuthFile {
    [key: string]: {
        type?: string;
        access?: string;
        refresh?: string;
        expires?: number;
    };
}

interface QuotaSnapshot {
    entitlement?: number;
    remaining?: number;
    percent_remaining?: number;
    unlimited?: boolean;
    overage_permitted?: boolean;
}

interface CopilotUserResponse {
    login?: string;
    copilot_plan?: string;
    organization_list?: Array<{ login: string }>;
    quota_reset_date?: string;
    quota_snapshots?: Record<string, QuotaSnapshot>;
}

async function readCopilotToken(): Promise<string | null> {
    try {
        const raw = await readFile(AUTH_FILE(), "utf-8");
        const auth: AuthFile = JSON.parse(raw);
        const token = auth["github-copilot"]?.access;
        if (!token) {
            logger.debug("copilot:no_token_in_auth", {});
            return null;
        }
        return token;
    } catch (e) {
        logger.debug("copilot:read_auth_failed", { error: e });
        return null;
    }
}

function formatResetDate(dateStr: string | undefined): string | undefined {
    if (!dateStr) return undefined;
    try {
        const resetDate = new Date(dateStr);
        const now = Date.now();
        const diffMs = resetDate.getTime() - now;
        if (diffMs <= 0) return "now";
        const days = Math.floor(diffMs / 86_400_000);
        const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
        if (days > 0) return `${days}d ${hours}h`;
        return `${hours}h`;
    } catch {
        return undefined;
    }
}

function extractQuotas(data: CopilotUserResponse): QuotaData[] {
    const quotas: QuotaData[] = [];
    const snapshots = data.quota_snapshots ?? {};
    const resetStr = formatResetDate(data.quota_reset_date);
    const planInfo = data.copilot_plan
        ? `${data.copilot_plan}${data.organization_list?.[0] ? ` (${data.organization_list[0].login})` : ""}`
        : undefined;

    // Premium interactions
    const premium = snapshots.premium_interactions;
    if (premium) {
        const entitlement = premium.entitlement ?? 0;
        const remaining = premium.remaining ?? 0;
        const used = entitlement - remaining;
        quotas.push({
            id: "copilot-premium",
            providerName: "Copilot Premium",
            used,
            limit: entitlement,
            unit: "interactions",
            reset: resetStr,
            window: "monthly",
            info: planInfo,
        });
    }

    // Chat quota
    const chat = snapshots.chat;
    if (chat) {
        if (chat.unlimited) {
            quotas.push({
                id: "copilot-chat",
                providerName: "Copilot Chat",
                used: 0,
                limit: null,
                unit: "requests",
                info: "unlimited",
            });
        } else if (chat.entitlement) {
            const remaining = chat.remaining ?? 0;
            quotas.push({
                id: "copilot-chat",
                providerName: "Copilot Chat",
                used: chat.entitlement - remaining,
                limit: chat.entitlement,
                unit: "requests",
                reset: resetStr,
            });
        }
    }

    // Completions quota
    const completions = snapshots.completions;
    if (completions) {
        if (completions.unlimited) {
            quotas.push({
                id: "copilot-completions",
                providerName: "Copilot Completions",
                used: 0,
                limit: null,
                unit: "requests",
                info: "unlimited",
            });
        } else if (completions.entitlement) {
            const remaining = completions.remaining ?? 0;
            quotas.push({
                id: "copilot-completions",
                providerName: "Copilot Completions",
                used: completions.entitlement - remaining,
                limit: completions.entitlement,
                unit: "requests",
                reset: resetStr,
            });
        }
    }

    return quotas;
}

export function createCopilotProvider(): IQuotaProvider {
    return {
        id: "copilot",
        async fetchQuota(): Promise<QuotaData[]> {
            const token = await readCopilotToken();
            if (!token) {
                logger.debug("copilot:no_token", {});
                return [];
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);

            try {
                logger.debug("copilot:fetch_start", { url: COPILOT_URL });

                const res = await fetch(COPILOT_URL, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Accept": "application/json",
                        "Editor-Version": "vscode/1.96.2",
                        "Editor-Plugin-Version": "copilot-chat/0.26.7",
                        "User-Agent": "GitHubCopilotChat/0.26.7",
                        "X-Github-Api-Version": "2025-04-01",
                    },
                    signal: controller.signal,
                });

                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    logger.debug("copilot:fetch_error", {
                        status: res.status,
                        body: body.slice(0, 200),
                    });
                    return [];
                }

                const data: CopilotUserResponse = await res.json();
                logger.debug("copilot:fetch_ok", { plan: data.copilot_plan });

                return extractQuotas(data);
            } catch (e: any) {
                if (e?.name === "AbortError") {
                    logger.debug("copilot:timeout", {});
                } else {
                    logger.debug("copilot:fetch_exception", { error: e });
                }
                return [];
            } finally {
                clearTimeout(timeout);
            }
        },
    };
}
