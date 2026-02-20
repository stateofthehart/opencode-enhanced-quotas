/**
 * Retry utilities with exponential backoff and jitter
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  retryableErrors?: (number | string)[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ENETUNREACH',
    'rate_limit',
    429,
    500,
    502,
    503,
    504
  ]
};

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = cappedDelay * config.jitterFactor * (2 * Math.random() - 1);
  return Math.floor(cappedDelay + jitter);
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown, config: RetryConfig): boolean {
  if (!config.retryableErrors) return false;

  const errorStr = String(error);

  for (const retryable of config.retryableErrors) {
    if (typeof retryable === 'number') {
      if (errorStr.includes(`statusCode: ${retryable}`) || errorStr.includes(`${retryable}`)) {
        return true;
      }
    } else {
      if (errorStr.includes(retryable)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt >= cfg.maxRetries;
      const shouldRetry = !isLastAttempt && isRetryable(error, cfg);

      if (!shouldRetry) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalTimeMs: Date.now() - startTime
        };
      }

      const delay = calculateDelay(attempt, cfg);
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: cfg.maxRetries + 1,
    totalTimeMs: Date.now() - startTime
  };
}

/**
 * Retry with circuit breaker integration
 */
export async function withRetryAndCircuitBreaker<T>(
  fn: () => Promise<T>,
  circuitBreakerExecute: (fn: () => Promise<T>) => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let lastError: Error | undefined;
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await circuitBreakerExecute(fn);
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt >= cfg.maxRetries;
      const shouldRetry = !isLastAttempt && isRetryable(error, cfg);

      if (!shouldRetry) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalTimeMs: Date.now() - startTime
        };
      }

      const delay = calculateDelay(attempt, cfg);
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: cfg.maxRetries + 1,
    totalTimeMs: Date.now() - startTime
  };
}

/**
 * Create a retryable function wrapper
 */
export function createRetryableFunction<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config?: Partial<RetryConfig>
): T {
  return ((...args: any[]) => withRetry(() => fn(...args), config)) as T;
}
