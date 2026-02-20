import {
  ProbeResult,
  ProviderHealth,
  QuotaError,
  IHealthMonitor,
} from "../interfaces.js";

interface HealthRecord {
  provider: string;
  probes: ProbeResult[];
  lastProbe?: Date;
  lastSuccess?: Date;
  consecutiveFailures: number;
}

const MAX_PROBE_HISTORY = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class HealthMonitor implements IHealthMonitor {
  private records: Map<string, HealthRecord> = new Map();

  recordProbe(result: ProbeResult): void {
    let record = this.records.get(result.provider);
    if (!record) {
      record = {
        provider: result.provider,
        probes: [],
        consecutiveFailures: 0,
      };
      this.records.set(result.provider, record);
    }

    record.probes.push(result);
    record.lastProbe = result.timestamp;

    if (record.probes.length > MAX_PROBE_HISTORY) {
      record.probes = record.probes.slice(-MAX_PROBE_HISTORY);
    }

    if (result.available) {
      record.lastSuccess = result.timestamp;
      record.consecutiveFailures = 0;
    } else {
      record.consecutiveFailures++;
    }
  }

  getHealth(provider: string): ProviderHealth {
    const record = this.records.get(provider);
    if (!record) {
      return {
        provider,
        status: "unknown",
        errorRate: 0,
        consecutiveFailures: 0,
        totalProbes: 0,
        successfulProbes: 0,
      };
    }

    const successfulProbes = record.probes.filter((p) => p.available).length;
    const totalProbes = record.probes.length;
    const errorRate = totalProbes > 0 ? (totalProbes - successfulProbes) / totalProbes : 0;

    let status: ProviderHealth["status"] = "unknown";
    if (record.consecutiveFailures === 0 && record.lastSuccess) {
      status = "healthy";
    } else if (record.consecutiveFailures > 0 && record.consecutiveFailures < 3) {
      status = "degraded";
    } else if (record.consecutiveFailures >= 3) {
      status = "down";
    }

    const lastSuccessfulProbe = record.probes.filter((p) => p.available).pop();
    const avgLatencyMs =
      successfulProbes > 0
        ? record.probes
            .filter((p) => p.available)
            .reduce((sum, p) => sum + p.latencyMs, 0) / successfulProbes
        : undefined;

    return {
      provider,
      status,
      lastProbe: record.lastProbe,
      lastSuccess: record.lastSuccess,
      latencyMs: lastSuccessfulProbe?.latencyMs,
      avgLatencyMs,
      errorRate,
      consecutiveFailures: record.consecutiveFailures,
      totalProbes,
      successfulProbes,
      lastError: lastSuccessfulProbe ? undefined : record.probes[record.probes.length - 1]?.error,
      rateLimitRemaining: lastSuccessfulProbe?.rateLimitRemaining,
      rateLimitReset: lastSuccessfulProbe?.rateLimitReset,
    };
  }

  getAllHealth(): ProviderHealth[] {
    return Array.from(this.records.keys()).map((provider) => this.getHealth(provider));
  }

  getAvailableProviders(): string[] {
    return this.getAllHealth()
      .filter((h) => h.status === "healthy" || h.status === "degraded")
      .map((h) => h.provider);
  }

  getCacheAge(provider: string): number {
    const record = this.records.get(provider);
    if (!record || !record.lastProbe) return Infinity;
    return Date.now() - record.lastProbe.getTime();
  }

  isCacheValid(provider: string): boolean {
    return this.getCacheAge(provider) < CACHE_TTL_MS;
  }

  getSuccessfulProbe(provider: string): ProbeResult | undefined {
    const record = this.records.get(provider);
    if (!record) return undefined;
    return record.probes.filter((p) => p.available).pop();
  }

  getRecentProbes(provider: string, count: number = 10): ProbeResult[] {
    const record = this.records.get(provider);
    if (!record) return [];
    return record.probes.slice(-count);
  }
}

let instance: HealthMonitor | null = null;

export function getHealthMonitor(): HealthMonitor {
  if (!instance) {
    instance = new HealthMonitor();
  }
  return instance;
}

export function resetHealthMonitor(): void {
  instance = null;
}
