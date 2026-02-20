import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import {
  ModelState,
  ModelFilterOptions,
  IModelStateTracker,
} from '../interfaces';
import {
  CircuitBreakerRegistry,
  CircuitBreakerStats,
  CircuitState,
  DEFAULT_CIRCUIT_CONFIG
} from '../gateway/circuit-breaker';

const STATE_FILE = path.join(
  homedir(),
  '.config',
  'opencode',
  'model-states.json'
);

const DEAD_MODEL_PATTERNS = [
  'retired',
  'deprecated',
  'no longer available',
  'model not found',
  'does not exist',
  'invalid model',
  '404',
  'model does not exist',
  'is not available',
  'has been deprecated',
  'has been retired',
  'no longer supported'
];

export class ModelStateTracker implements IModelStateTracker {
  private states: Map<string, ModelState> = new Map();
  private initialized: boolean = false;
  private circuitBreakers: CircuitBreakerRegistry;

  constructor(circuitConfig?: Partial<typeof DEFAULT_CIRCUIT_CONFIG>) {
    this.circuitBreakers = new CircuitBreakerRegistry({
      ...DEFAULT_CIRCUIT_CONFIG,
      ...circuitConfig
    });
  }

  private getKey(provider: string, modelId: string): string {
    return `${provider}:${modelId}`;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.loadStates();
    this.initialized = true;
  }

  private async loadStates(): Promise<void> {
    try {
      const data = await fs.readFile(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      this.states = new Map(Object.entries(parsed.states || {}));
      
      for (const [key, state] of this.states) {
        if (state.lastChecked) state.lastChecked = new Date(state.lastChecked);
        if (state.lastSuccess) state.lastSuccess = new Date(state.lastSuccess);
        if (state.lastError) state.lastError = new Date(state.lastError);
        if (state.rateLimitReset) state.rateLimitReset = new Date(state.rateLimitReset);
      }
    } catch (err) {
      this.states = new Map();
    }
  }

  private async saveStates(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      const data = {
        lastUpdated: new Date().toISOString(),
        states: Object.fromEntries(this.states),
      };
      await fs.writeFile(STATE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Failed to save model states:', err);
    }
  }

  async updateModelState(state: ModelState): Promise<void> {
    await this.ensureInitialized();
    const key = this.getKey(state.provider, state.modelId);
    this.states.set(key, state);
    await this.saveStates();
  }

  async getModelState(provider: string, modelId: string): Promise<ModelState | null> {
    await this.ensureInitialized();
    const key = this.getKey(provider, modelId);
    return this.states.get(key) || null;
  }

  async getAllModelStates(filter?: ModelFilterOptions): Promise<ModelState[]> {
    await this.ensureInitialized();
    let states = Array.from(this.states.values());

    if (filter) {
      states = await this.applyFilter(states, filter);
    }

    return states.sort((a, b) => {
      if (a.isAvailable !== b.isAvailable) {
        return a.isAvailable ? -1 : 1;
      }
      if (a.lastSuccess && b.lastSuccess) {
        return b.lastSuccess.getTime() - a.lastSuccess.getTime();
      }
      return 0;
    });
  }

  async getAvailableModels(filter?: ModelFilterOptions): Promise<ModelState[]> {
    const options: ModelFilterOptions = {
      ...filter,
      onlyAvailable: true,
    };
    return this.getAllModelStates(options);
  }

  private async applyFilter(states: ModelState[], filter: ModelFilterOptions): Promise<ModelState[]> {
    const results: ModelState[] = [];
    
    for (const state of states) {
      let include = true;
      
      if (filter.excludeDead !== false && state.isDead) {
        include = false;
      }
      
      if (include && filter.onlyAvailable && !state.isAvailable) {
        include = false;
      }
      
      if (include && filter.onlyFree && !state.isFreeTier) {
        include = false;
      }
      
      if (include && filter.excludeRateLimited && state.isRateLimited) {
        if (state.rateLimitReset && state.rateLimitReset > new Date()) {
          include = false;
        }
      }
      
      if (include && filter.excludeTimeouts && state.timeoutCount > 2) {
        include = false;
      }
      
      if (include && filter.maxLatency && state.avgLatencyMs && state.avgLatencyMs > filter.maxLatency) {
        include = false;
      }

      if (include) {
        const circuitKey = this.getKey(state.provider, state.modelId);
        const circuitStats = this.circuitBreakers.getStats(circuitKey);
        if (filter.excludeCircuitOpen && circuitStats?.state === CircuitState.OPEN) {
          include = false;
        }
      }
      
      if (include) {
        results.push(state);
      }
    }
    
    return results;
  }

  async markModelDead(provider: string, modelId: string, reason: string = "unknown"): Promise<void> {
    const state = await this.getModelState(provider, modelId) || {
      provider,
      modelId,
      isAvailable: false,
      lastChecked: new Date(),
      errorCount: 0,
      consecutiveFailures: 0,
      isRateLimited: false,
      isFreeTier: true,
      timeoutCount: 0,
    };

    state.isDead = true;
    state.deadReason = reason;
    state.deadSince = new Date();
    state.isAvailable = false;

    await this.updateModelState(state);
  }

  async isModelDead(provider: string, modelId: string): Promise<boolean> {
    const state = await this.getModelState(provider, modelId);
    return state?.isDead ?? false;
  }

  async markModelTimeout(provider: string, modelId: string): Promise<void> {
    const state = await this.getModelState(provider, modelId) || {
      provider,
      modelId,
      isAvailable: false,
      lastChecked: new Date(),
      errorCount: 0,
      consecutiveFailures: 0,
      isRateLimited: false,
      isFreeTier: true,
      timeoutCount: 0,
    };

    state.timeoutCount++;
    state.consecutiveFailures++;
    state.isAvailable = state.timeoutCount < 3;
    state.lastError = new Date();
    state.lastChecked = new Date();

    await this.updateModelState(state);
  }

  async markModelRateLimited(provider: string, modelId: string, resetAt?: Date): Promise<void> {
    const state = await this.getModelState(provider, modelId) || {
      provider,
      modelId,
      isAvailable: true,
      lastChecked: new Date(),
      errorCount: 0,
      consecutiveFailures: 0,
      isRateLimited: false,
      isFreeTier: true,
      timeoutCount: 0,
    };

    state.isRateLimited = true;
    state.rateLimitReset = resetAt || new Date(Date.now() + 60000);
    state.lastChecked = new Date();

    await this.updateModelState(state);
  }

  async markModelSuccess(provider: string, modelId: string, latencyMs: number): Promise<void> {
    const state = await this.getModelState(provider, modelId) || {
      provider,
      modelId,
      isAvailable: true,
      lastChecked: new Date(),
      errorCount: 0,
      consecutiveFailures: 0,
      isRateLimited: false,
      isFreeTier: true,
      timeoutCount: 0,
    };

    state.isAvailable = true;
    state.consecutiveFailures = 0;
    state.isRateLimited = false;
    state.rateLimitReset = undefined;
    state.lastSuccess = new Date();
    state.lastChecked = new Date();
    
    if (state.avgLatencyMs) {
      state.avgLatencyMs = state.avgLatencyMs * 0.7 + latencyMs * 0.3;
    } else {
      state.avgLatencyMs = latencyMs;
    }

    await this.updateModelState(state);
  }

  async markModelFailure(provider: string, modelId: string, error?: string): Promise<void> {
    if (error && await this.detectDeadModel(provider, modelId, error)) {
      return;
    }

    const state = await this.getModelState(provider, modelId) || {
      provider,
      modelId,
      isAvailable: true,
      lastChecked: new Date(),
      errorCount: 0,
      consecutiveFailures: 0,
      isRateLimited: false,
      isFreeTier: true,
      timeoutCount: 0,
    };

    state.errorCount++;
    state.consecutiveFailures++;
    state.lastError = new Date();
    state.lastChecked = new Date();

    if (state.consecutiveFailures >= 3) {
      state.isAvailable = false;
    }

    await this.updateModelState(state);
  }

  async clearOldStates(olderThan: Date): Promise<void> {
    await this.ensureInitialized();
    
    for (const [key, state] of this.states) {
      if (state.lastChecked < olderThan) {
        this.states.delete(key);
        this.circuitBreakers.remove(key);
      }
    }

    await this.saveStates();
  }

  async recordSuccess(provider: string, modelId: string, latencyMs: number): Promise<void> {
    return this.markModelSuccess(provider, modelId, latencyMs);
  }

  async recordError(provider: string, modelId: string, error: string): Promise<void> {
    return this.markModelFailure(provider, modelId, error);
  }

  private getCircuitKey(provider: string, modelId: string): string {
    return `${provider}:${modelId}`;
  }

  async executeWithCircuitBreaker<T>(
    provider: string,
    modelId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const key = this.getCircuitKey(provider, modelId);
    const breaker = this.circuitBreakers.getBreaker(key);
    
    try {
      const result = await breaker.execute(fn);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'CircuitBreakerOpenError') {
        await this.markModelRateLimited(provider, modelId);
      }
      throw error;
    }
  }

  async getCircuitBreakerStats(provider: string, modelId: string): Promise<CircuitBreakerStats | null> {
    const key = this.getCircuitKey(provider, modelId);
    return this.circuitBreakers.getStats(key);
  }

  getAllCircuitBreakerStats(): Map<string, CircuitBreakerStats> {
    return this.circuitBreakers.getAllStats();
  }

  async resetCircuitBreaker(provider: string, modelId: string): Promise<void> {
    const key = this.getCircuitKey(provider, modelId);
    this.circuitBreakers.reset(key);
  }

  async isCircuitOpen(provider: string, modelId: string): Promise<boolean> {
    const key = this.getCircuitKey(provider, modelId);
    const stats = this.circuitBreakers.getStats(key);
    return stats?.state === CircuitState.OPEN;
  }

  isDeadModelError(error: string | undefined): boolean {
    if (!error) return false;
    const lowerError = error.toLowerCase();
    return DEAD_MODEL_PATTERNS.some(pattern => lowerError.includes(pattern.toLowerCase()));
  }

  async detectDeadModel(provider: string, modelId: string, error: string): Promise<boolean> {
    if (this.isDeadModelError(error)) {
      await this.markModelDead(provider, modelId, error);
      const key = this.getCircuitKey(provider, modelId);
      this.circuitBreakers.reset(key);
      return true;
    }
    return false;
  }
}

let instance: ModelStateTracker | null = null;

export function getModelStateTracker(): ModelStateTracker {
  if (!instance) {
    instance = new ModelStateTracker();
  }
  return instance;
}
