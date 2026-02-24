import { type QuotaData } from "./interfaces.js";
import { logger } from "./logger.js";

// New unified response types from gateway
export interface QuotaEntry {
    id: string;
    name: string;
    used: number;
    limit: number | null;
    unit: string;
    reset?: string;
    window?: string;
    source: 'api' | 'balance' | 'header' | 'status';
    info?: string;
}

export interface RateLimitEntry {
    type: 'requests' | 'tokens';
    used: number;
    limit: number;
    remaining: number;
    resetIn?: string;
    window?: string;
}

export interface UsageEntry {
    requests: number;
    tokens: number;
    avgLatencyMs?: number;
    successRate?: number;
}

export interface ProviderQuota {
    id: string;
    name: string;
    status: 'ok' | 'warning' | 'error' | 'limited' | 'unavailable';
    hasAuth: boolean;
    quotas: QuotaEntry[];
    rateLimits: RateLimitEntry[];
    usage: UsageEntry;
    primarySource: 'api' | 'balance' | 'header' | 'status';
    message?: string;
}

export interface UnifiedQuotasResponse {
    providers: ProviderQuota[];
    lastUpdated: string;
    summary: {
        totalProviders: number;
        connectedProviders: number;
        limitedProviders: number;
        errorProviders: number;
    };
}

// Legacy response type (for backward compatibility)
export interface GatewayQuotasResponse {
    quotas: QuotaData[];
    rateLimits?: Array<{
        provider: string;
        limitRequests?: number;
        remainingRequests?: number;
        limitTokens?: number;
        remainingTokens?: number;
    }>;
    usage?: Array<{
        provider: string;
        requests?: number;
        tokens?: number;
    }>;
}

/**
 * Converts unified provider quotas to legacy QuotaData format.
 * This maintains backward compatibility with the rest of the plugin.
 */
function providerQuotasToQuotaData(providers: ProviderQuota[]): QuotaData[] {
    const results: QuotaData[] = [];
    
    for (const provider of providers) {
        // Add each quota entry as a QuotaData
        for (const quota of provider.quotas) {
            results.push({
                id: quota.id,
                providerName: quota.name,
                used: quota.used,
                limit: quota.limit,
                unit: quota.unit,
                reset: quota.reset,
                window: quota.window,
                info: quota.info ? `${quota.info} (${quota.source})` : `source: ${quota.source}`
            });
        }
        
        // Add rate limits as separate entries if no quota exists
        for (const rl of provider.rateLimits) {
            const existingQuota = provider.quotas.find(q => 
                q.unit === rl.type || q.unit.includes(rl.type)
            );
            
            if (!existingQuota) {
                results.push({
                    id: `${provider.id}-${rl.type}`,
                    providerName: provider.name,
                    used: rl.used,
                    limit: rl.limit,
                    unit: rl.type,
                    reset: rl.resetIn,
                    timeout: rl.resetIn,
                    info: `rate limit (header)`
                });
            }
        }
    }
    
    return results;
}

export async function fetchQuotasFromGateway(gatewayUrl: string): Promise<QuotaData[]> {
    const url = `${gatewayUrl.replace(/\/$/, "")}/quotas`;
    const startedAt = Date.now();
    
    try {
        logger.debug("gateway:fetch_start", { url });
        
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
            },
            signal: AbortSignal.timeout(15000),
        });
        
        if (!response.ok) {
            throw new Error(`Gateway returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Handle new unified format
        if (data.providers && Array.isArray(data.providers)) {
            const unified = data as UnifiedQuotasResponse;
            logger.debug("gateway:fetch_ok", { 
                providerCount: unified.providers.length,
                summary: unified.summary,
                durationMs: Date.now() - startedAt 
            });
            return providerQuotasToQuotaData(unified.providers);
        }
        
        // Handle legacy format
        const legacy = data as GatewayQuotasResponse;
        logger.debug("gateway:fetch_ok", { 
            quotaCount: legacy.quotas?.length ?? 0,
            durationMs: Date.now() - startedAt 
        });
        return legacy.quotas ?? [];
    } catch (e) {
        logger.error("gateway:fetch_error", { 
            url, 
            durationMs: Date.now() - startedAt,
            error: e 
        });
        return [];
    }
}

export async function checkGatewayHealth(gatewayUrl: string): Promise<boolean> {
    const url = `${gatewayUrl.replace(/\/$/, "")}/health`;
    
    try {
        const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Fetches the full unified response from the gateway.
 * Use this for more detailed provider information.
 */
export async function fetchUnifiedQuotasFromGateway(gatewayUrl: string): Promise<UnifiedQuotasResponse | null> {
    const url = `${gatewayUrl.replace(/\/$/, "")}/quotas`;
    
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
            },
            signal: AbortSignal.timeout(15000),
        });
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        
        if (data.providers && Array.isArray(data.providers)) {
            return data as UnifiedQuotasResponse;
        }
        
        return null;
    } catch {
        return null;
    }
}
