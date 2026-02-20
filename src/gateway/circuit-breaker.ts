/**
 * Circuit Breaker Implementation
 * Provides per-model and per-provider circuit breaker functionality
 * for handling failing endpoints and dead models
 */

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeoutMs: 30000,
  halfOpenMaxCalls: 3
};

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  totalCalls: number;
  consecutiveFailures: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private totalCalls: number = 0;
  private consecutiveFailures: number = 0;
  private halfOpenCalls: number = 0;

  constructor(
    private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG
  ) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (!this.canExecute()) {
      throw new CircuitBreakerOpenError(
        `Circuit breaker is ${this.state}`,
        this.getStats()
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if we can attempt a call
   */
  private canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (this.shouldAttemptRecovery()) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return this.halfOpenCalls < this.config.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * Check if enough time has passed to attempt recovery
   */
  private shouldAttemptRecovery(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime.getTime() > this.config.timeoutMs;
  }

  /**
   * Handle successful call
   */
  private onSuccess(): void {
    this.lastSuccessTime = new Date();
    this.consecutiveFailures = 0;

    switch (this.state) {
      case CircuitState.CLOSED:
        this.failureCount = Math.max(0, this.failureCount - 1);
        break;

      case CircuitState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;

      case CircuitState.OPEN:
        break;
    }
  }

  /**
   * Handle failed call
   */
  private onFailure(): void {
    this.lastFailureTime = new Date();
    this.failureCount++;
    this.consecutiveFailures++;

    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.consecutiveFailures >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;

      case CircuitState.HALF_OPEN:
        this.transitionToOpen();
        break;

      case CircuitState.OPEN:
        break;
    }
  }

  /**
   * Transition to CLOSED state (recovered)
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
    this.halfOpenCalls = 0;
    console.log(`[CircuitBreaker] State: CLOSED (recovered)`);
  }

  /**
   * Transition to OPEN state (failing)
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.halfOpenCalls = 0;
    console.log(`[CircuitBreaker] State: OPEN (failure threshold reached)`);
  }

  /**
   * Transition to HALF_OPEN state (testing recovery)
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenCalls = 0;
    this.successCount = 0;
    console.log(`[CircuitBreaker] State: HALF_OPEN (testing recovery)`);
  }

  /**
   * Get current stats
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
    this.halfOpenCalls = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
  }

  /**
   * Force transition to a specific state
   */
  setState(state: CircuitState): void {
    this.state = state;
    if (state === CircuitState.HALF_OPEN) {
      this.halfOpenCalls = 0;
    }
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message: string, public stats: CircuitBreakerStats) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Manages multiple circuit breakers for different providers/models
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor(
    private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG
  ) {}

  /**
   * Get or create a circuit breaker for a key
   */
  getBreaker(key: string): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing) {
      return existing;
    }

    const breaker = new CircuitBreaker(this.config);
    this.breakers.set(key, breaker);
    return breaker;
  }

  /**
   * Execute with circuit breaker protection
   */
  async executeWithBreaker<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const breaker = this.getBreaker(key);
    return breaker.execute(fn);
  }

  /**
   * Get stats for a specific breaker
   */
  getStats(key: string): CircuitBreakerStats | null {
    return this.breakers.get(key)?.getStats() ?? null;
  }

  /**
   * Get all breaker stats
   */
  getAllStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();
    for (const [key, breaker] of this.breakers.entries()) {
      stats.set(key, breaker.getStats());
    }
    return stats;
  }

  /**
   * Reset a specific breaker
   */
  reset(key: string): void {
    this.breakers.get(key)?.reset();
  }

  /**
   * Reset all breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get all keys (provider:model)
   */
  getKeys(): string[] {
    return Array.from(this.breakers.keys());
  }

  /**
   * Remove a breaker
   */
  remove(key: string): void {
    this.breakers.delete(key);
  }

  /**
   * Get breakers in open state
   */
  getOpenBreakers(): string[] {
    const open: string[] = [];
    for (const [key, breaker] of this.breakers.entries()) {
      if (breaker.getState() === CircuitState.OPEN) {
        open.push(key);
      }
    }
    return open;
  }
}
