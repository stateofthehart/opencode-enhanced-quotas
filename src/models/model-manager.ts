import { getModelDiscovery } from '../discovery';
import { getProber } from '../probe';
import { getModelStateTracker } from '../state/model-state';
import {
  DiscoveredModel,
  ModelState,
  ModelFilterOptions,
  IModelDiscovery,
  IProber,
  IModelStateTracker,
  ProviderCapability,
  ProbeResult,
} from '../interfaces';

export interface TrackedModel {
  provider: string;
  modelId: string;
  isAvailable: boolean;
  isFree: boolean;
  latencyMs?: number;
  lastChecked: Date;
  isRateLimited: boolean;
  rateLimitReset?: Date;
  timeoutCount: number;
  errorCount: number;
  avgLatencyMs?: number;
}

export interface ModelManagerConfig {
  maxConcurrentProbes?: number;
  probeTimeout?: number;
  cacheDurationMs?: number;
}

export class ModelManager {
  private discovery: IModelDiscovery;
  private prober: IProber;
  private stateTracker: IModelStateTracker;
  private config: ModelManagerConfig;
  private lastFullScan?: Date;

  constructor(
    discovery: IModelDiscovery,
    prober: IProber,
    stateTracker: IModelStateTracker,
    config: ModelManagerConfig = {}
  ) {
    this.discovery = discovery;
    this.prober = prober;
    this.stateTracker = stateTracker;
    this.config = {
      maxConcurrentProbes: config.maxConcurrentProbes || 5,
      probeTimeout: config.probeTimeout || 30000,
      cacheDurationMs: config.cacheDurationMs || 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Get all available models with optional filtering
   */
  async getAvailableModels(filter?: ModelFilterOptions): Promise<TrackedModel[]> {
    const states = await this.stateTracker.getAvailableModels(filter);
    return this.convertStatesToInfo(states);
  }

  /**
   * Get only free tier models
   */
  async getFreeModels(): Promise<TrackedModel[]> {
    return this.getAvailableModels({ onlyFree: true });
  }

  /**
   * Get models that can be used with current balance
   */
  async getModelsWithBalance(minBalance: number = 0): Promise<TrackedModel[]> {
    return this.getAvailableModels({ minBalance });
  }

  /**
   * Perform a full scan of all providers and update model states
   */
  async scanAllProviders(providers: string[]): Promise<TrackedModel[]> {
    console.log('🔍 Scanning all providers for available models...');
    
    const results: TrackedModel[] = [];
    
    for (const provider of providers) {
      try {
        const providerModels = await this.scanProvider(provider);
        results.push(...providerModels);
      } catch (err) {
        console.warn(`⚠️ Failed to scan provider ${provider}:`, (err as Error).message);
      }
    }

    this.lastFullScan = new Date();
    return results;
  }

  /**
   * Scan a specific provider for available models
   */
  async scanProvider(providerId: string): Promise<TrackedModel[]> {
    try {
      // Discover models from provider
      const modelList = await this.discovery.discoverModels(providerId);
      
      if (!modelList.models.length) {
        console.warn(`⚠️ No models found for provider: ${providerId}`);
        return [];
      }

      const results: TrackedModel[] = [];

      // Probe each model to check availability
      for (const model of modelList.models) {
        try {
          const probeResult = await this.prober.probe(providerId, model.id, {
            timeout: this.config.probeTimeout,
            maxTokens: 10,
            prompt: 'Hi',
          });

          const modelInfo = await this.processProbeResult(
            providerId,
            model.id,
            model.isFree,
            probeResult
          );

          results.push(modelInfo);
        } catch (err) {
          console.warn(`⚠️ Failed to probe ${providerId}/${model.id}:`, (err as Error).message);
          
          // Mark as failure in state tracker
          await this.stateTracker.markModelFailure(
            providerId,
            model.id,
            (err as Error).message
          );
        }
      }

      return results;
    } catch (err) {
      console.error(`❌ Failed to scan provider ${providerId}:`, (err as Error).message);
      return [];
    }
  }

  /**
   * Process probe result and update state
   */
  private async processProbeResult(
    provider: string,
    modelId: string,
    isFree: boolean,
    probeResult: ProbeResult
  ): Promise<TrackedModel> {
    // Check for permanently retired/dead models
    const errorMsg = (probeResult.error?.message || probeResult.error?.type || '').toLowerCase();
    const isDeadModel = errorMsg.includes('retired') || 
                        errorMsg.includes('deprecated') ||
                        errorMsg.includes('no longer available') ||
                        errorMsg.includes('model not found') ||
                        errorMsg.includes('does not exist') ||
                        errorMsg.includes('invalid model');

    if (isDeadModel) {
      await this.stateTracker.markModelDead(provider, modelId, probeResult.error?.message || 'Model retired');
    } else if (probeResult.available) {
      await this.stateTracker.markModelSuccess(provider, modelId, probeResult.latencyMs);
    } else if (probeResult.error?.type === 'rate_limited' || 
               errorMsg.includes('rate limit') ||
               errorMsg.includes('too many requests')) {
      await this.stateTracker.markModelRateLimited(provider, modelId, probeResult.rateLimitReset);
    } else if (probeResult.error?.type === 'endpoint_down' || 
               errorMsg.includes('timeout') ||
               errorMsg.includes('connection refused')) {
      await this.stateTracker.markModelTimeout(provider, modelId);
    } else {
      const errorMessage = probeResult.error?.message || probeResult.error?.type || String(probeResult.error);
      await this.stateTracker.markModelFailure(provider, modelId, errorMessage);
    }

    const state = await this.stateTracker.getModelState(provider, modelId);
    
    return {
      provider,
      modelId,
      isAvailable: probeResult.available,
      isFree,
      latencyMs: probeResult.latencyMs,
      lastChecked: new Date(),
      isRateLimited: state?.isRateLimited || false,
      rateLimitReset: state?.rateLimitReset,
      timeoutCount: state?.timeoutCount || 0,
      errorCount: state?.errorCount || 0,
      avgLatencyMs: state?.avgLatencyMs,
    };
  }

  /**
   * Check if a model is currently available (respecting rate limits and timeouts)
   */
  async isModelAvailable(provider: string, modelId: string): Promise<boolean> {
    const state = await this.stateTracker.getModelState(provider, modelId);
    
    if (!state) {
      return false;
    }

    // Check if model is dead/retired
    if (state.isDead) {
      return false;
    }

    // Check if rate limited
    if (state.isRateLimited && state.rateLimitReset && state.rateLimitReset > new Date()) {
      return false;
    }

    // Check if too many timeouts
    if (state.timeoutCount >= 3) {
      return false;
    }

    // Check if too many consecutive failures
    if (state.consecutiveFailures >= 3) {
      return false;
    }

    // Check if cache is stale
    if (this.lastFullScan) {
      const cacheAge = Date.now() - this.lastFullScan.getTime();
      if (cacheAge > this.config.cacheDurationMs!) {
        return false; // Cache is stale, need to rescan
      }
    }

    return state.isAvailable;
  }

  /**
   * Get the best available model based on latency and reliability
   */
  async getBestModel(
    providers: string[],
    requireFree: boolean = false
  ): Promise<TrackedModel | null> {
    const filter: ModelFilterOptions = {
      onlyAvailable: true,
      onlyFree: requireFree,
      excludeRateLimited: true,
      excludeTimeouts: true,
      excludeDead: true,
    };

    const models = await this.getAvailableModels(filter);

    if (models.length === 0) {
      return null;
    }

    // Sort by: availability > low latency > low error count
    const sorted = models.sort((a, b) => {
      if (a.isAvailable !== b.isAvailable) {
        return a.isAvailable ? -1 : 1;
      }
      if (a.avgLatencyMs && b.avgLatencyMs) {
        return a.avgLatencyMs - b.avgLatencyMs;
      }
      if (a.avgLatencyMs) return -1;
      if (b.avgLatencyMs) return 1;
      return a.errorCount - b.errorCount;
    });

    return sorted[0];
  }

  /**
   * Record a successful request to a model
   */
  async recordSuccess(provider: string, modelId: string, latencyMs: number): Promise<void> {
    await this.stateTracker.recordSuccess(provider, modelId, latencyMs);
  }

  /**
   * Record an error for a model
   */
  async recordError(provider: string, modelId: string, error: string): Promise<void> {
    await this.stateTracker.recordError(provider, modelId, error);
  }

  /**
   * Clear old model states
   */
  async cleanup(olderThanHours: number = 24): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    await this.stateTracker.clearOldStates(cutoff);
  }

  private convertStatesToInfo(states: ModelState[]): TrackedModel[] {
    return states.map((state) => ({
      provider: state.provider,
      modelId: state.modelId,
      isAvailable: state.isAvailable,
      isFree: state.isFreeTier,
      latencyMs: state.avgLatencyMs,
      lastChecked: state.lastChecked,
      isRateLimited: state.isRateLimited,
      rateLimitReset: state.rateLimitReset,
      timeoutCount: state.timeoutCount,
      errorCount: state.errorCount,
      avgLatencyMs: state.avgLatencyMs,
    }));
  }
}

// Factory function
export function createModelManager(
  discovery: IModelDiscovery,
  prober: IProber,
  config?: ModelManagerConfig
): ModelManager {
  const stateTracker = getModelStateTracker();
  return new ModelManager(discovery, prober, stateTracker, config);
}
