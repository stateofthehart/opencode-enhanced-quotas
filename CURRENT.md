# OpenCode Enhanced Quotas - Current Implementation State

## Project Overview

**Project:** OpenCode Enhanced Quotas - API Gateway for intelligent LLM routing  
**Location:** `/home/ethan/documents/personal/github/opencode/quotas`  
**Build Status:** ✅ PASSING  
**Phase:** Phase 2.5 Complete - Gateway Fully Functional

---

## Executive Summary

Build an intelligent API Gateway that routes LLM requests to free providers with:
- Automatic failover between providers ✅
- Dead/retired model exclusion (permanent) ✅
- Rate limiting and timeout handling ✅
- Per-model circuit breakers ✅
- OpenAI-compatible endpoints ✅
- Persistent state tracking ✅
- `/v1/freemodels` endpoint for free tier model discovery ✅
- Working chat completions with auto-routing ✅

---

## Latest Session Summary (Feb 20, 2026)

### Fixes Applied:
1. **ESM Module Resolution** - Fixed missing `.js` extensions in imports across 6 files
2. **ESM Compatibility** - Replaced `require()` with static `import` for http/https modules
3. **Model ID Injection** - Fixed gateway to pass actual model ID to providers instead of "auto"
4. **Added `/v1/freemodels` endpoint** - Returns free models with extended metadata

### Verified Working:
- Gateway starts and discovers 69 models across 5 providers
- Chat completions successfully route through providers
- Auto-routing finds working models and returns responses

### Provider Keys Configured:
- Cerebras, Fireworks, OpenRouter, Mistral, Together, DeepInfra, Cloudflare, NVIDIA NIM, HuggingFace
- Keys saved to `~/.config/opencode/provider-keys.env`

---

## What Was Accomplished

### Phase 1: Fix Type Errors & Stabilize Build ✅

**Fixed 16 TypeScript errors:**

1. **`src/commands/models.ts`**
   - Changed import from `ModelInfo` to `TrackedModel` (the correct type)
   - Updated all type annotations for functions

2. **`src/gateway/server.ts`**
   - Changed import from `ModelInfo` to `TrackedModel`
   - Fixed `recordSuccess` calls to include `latencyMs` parameter (3 args required)
   - Fixed `model.status` to use `model.isAvailable`
   - Added explicit types to HTTP callbacks (`http.IncomingMessage`, `Buffer`, `Error`)
   - Added null check for `config.probeEndpoint`
   - Fixed Cloudflare accountId type handling

3. **`src/models/model-manager.ts`**
   - Fixed `recordError` method signature (was 4 args, fixed to 3 to match interface)

**Result:** Build passes with 0 errors

---

### Phase 2: Circuit Breaker Implementation ✅

#### 1. Circuit Breaker (`src/gateway/circuit-breaker.ts`)

**Purpose:** Per-model and per-provider circuit breaker functionality for handling failing endpoints and excluding dead models.

**Key Components:**

```typescript
enum CircuitState {
  CLOSED = 'closed',   // Normal operation
  OPEN = 'open',       // Failing, reject requests
  HALF_OPEN = 'half-open'  // Testing recovery
}

interface CircuitBreakerConfig {
  failureThreshold: number;    // 5 failures → OPEN
  successThreshold: number;    // 3 successes → CLOSED
  timeoutMs: number;           // 30000ms recovery timeout
  halfOpenMaxCalls: number;    // 3 test calls in HALF_OPEN
}

class CircuitBreaker {
  // Execute function with circuit breaker protection
  async execute<T>(fn: () => Promise<T>): Promise<T>
  
  // Get current stats
  getStats(): CircuitBreakerStats
  
  // Get/Set state
  getState(): CircuitState
  setState(state: CircuitState): void
  
  // Reset breaker
  reset(): void
}

class CircuitBreakerRegistry {
  // Get or create breaker for key (e.g., "groq:llama-3-70b")
  getBreaker(key: string): CircuitBreaker
  
  // Execute with circuit breaker
  executeWithBreaker<T>(key: string, fn: () => Promise<T>): Promise<T>
  
  // Get all stats
  getAllStats(): Map<string, CircuitBreakerStats>
  
  // Get open breakers
  getOpenBreakers(): string[]
}
```

**Default Configuration:**
```typescript
const DEFAULT_CIRCUIT_CONFIG = {
  failureThreshold: 5,      // Open after 5 consecutive failures
  successThreshold: 3,      // Close after 3 successes
  timeoutMs: 30000,        // Try recovery after 30 seconds
  halfOpenMaxCalls: 3      // Allow 3 test calls
};
```

---

#### 2. Retry Utilities (`src/gateway/retry.ts`)

**Purpose:** Exponential backoff with jitter for handling transient failures.

**Key Components:**

```typescript
interface RetryConfig {
  maxRetries: number;           // 3 retries default
  baseDelayMs: number;          // 1000ms base
  maxDelayMs: number;          // 30000ms max
  jitterFactor: number;        // 0.2 (20% jitter)
  retryableErrors?: (number | string)[];  // Default: ECONNRESET, ETIMEDOUT, 429, 500-504
}

// Retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<RetryResult<T>>

// Retry with circuit breaker integration
async function withRetryAndCircuitBreaker<T>(
  fn: () => Promise<T>,
  circuitBreakerExecute: (fn: () => Promise<T>) => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<RetryResult<T>>
```

---

#### 3. Model State Integration (`src/state/model-state.ts`)

**Purpose:** Persistent file-based tracking of model states with circuit breaker integration.

**Storage:** `~/.config/opencode/model-states.json`

**Dead Model Detection Patterns:**
```typescript
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
```

**Key Methods Added to ModelStateTracker:**

```typescript
class ModelStateTracker {
  // Execute with circuit breaker protection
  async executeWithCircuitBreaker<T>(
    provider: string,
    modelId: string,
    fn: () => Promise<T>
  ): Promise<T>
  
  // Get circuit breaker stats for a model
  async getCircuitBreakerStats(
    provider: string, 
    modelId: string
  ): Promise<CircuitBreakerStats | null>
  
  // Get all circuit breaker stats
  getAllCircuitBreakerStats(): Map<string, CircuitBreakerStats>
  
  // Reset circuit breaker for a model
  async resetCircuitBreaker(
    provider: string, 
    modelId: string
  ): Promise<void>
  
  // Check if circuit is open (model excluded)
  async isCircuitOpen(
    provider: string, 
    modelId: string
  ): Promise<boolean>
  
  // Check if error indicates dead model
  isDeadModelError(error: string | undefined): boolean
  
  // Auto-detect and mark dead models
  async detectDeadModel(
    provider: string, 
    modelId: string, 
    error: string
  ): Promise<boolean>
}
```

**Updated Filter Options (in `src/interfaces.ts`):**
```typescript
interface ModelFilterOptions {
  onlyAvailable?: boolean;
  onlyFree?: boolean;
  minBalance?: number;
  maxLatency?: number;
  excludeRateLimited?: boolean;
  excludeTimeouts?: boolean;
  excludeDead?: boolean;           // NEW: Exclude permanently retired/dead models
  excludeCircuitOpen?: boolean;     // NEW: Exclude models with open circuit breakers
}
```

---

## Current File Structure

```
opencode-enhanced-quotas/
├── src/
│   ├── gateway/
│   │   ├── server.ts           # API Gateway with OpenAI-compatible endpoints
│   │   ├── index.ts            # Exports (circuit breaker, retry, gateway)
│   │   ├── circuit-breaker.ts  # Circuit breaker implementation (NEW)
│   │   └── retry.ts            # Retry utilities (NEW)
│   │
│   ├── models/
│   │   └── model-manager.ts    # ModelManager class, TrackedModel interface
│   │
│   ├── state/
│   │   └── model-state.ts     # ModelStateTracker with circuit breaker (UPDATED)
│   │
│   ├── commands/
│   │   └── models.ts          # /mymodels and /freemodels CLI commands
│   │
│   ├── interfaces.ts          # Core types (ModelFilterOptions updated)
│   │
│   ├── discovery/             # Model discovery
│   ├── providers/             # Provider implementations (10+ providers)
│   └── probe/                 # Probing utilities
│
├── PHASES.md                  # Implementation plan
├── CURRENT.md                 # This file
└── package.json
```

---

## Supported Providers

| Provider | Base URL | OpenAI Compatible | Notes |
|----------|----------|-------------------|-------|
| Groq | `api.groq.com/openai/v1` | ✅ Full | Rate limits via headers |
| Fireworks | `api.fireworks.ai/inference/v1` | ✅ Full | Usage in streaming |
| HuggingFace | `router.huggingface.co/v1` | ✅ Full | Model format: `id:provider` |
| Cerebras | `api.cerebras.ai/v1` | ✅ Full | Fastest (~1800 tok/s) |
| NVIDIA NIM | `integrate.api.nvidia.com/v1` | ✅ Full | Self-hosted option |
| OpenRouter | `openrouter.ai/api/v1` | ✅ Full | Provider selection |
| Gemini | `generativelanguage.googleapis.com/v1beta/openai/` | ✅ Full | Uses `reasoning_effort` |
| Cloudflare | `api.cloudflare.com/client/v4/accounts/{id}/ai/v1` | ✅ Full | Uses `@cf/` prefix |
| Cohere | `api.cohere.ai/v2/chat` | ⚠️ Transform | Different params |
| Custom providers | Various | ❌ | Via probeEndpoint |

---

## Key Interfaces

### TrackedModel (`src/models/model-manager.ts`)
```typescript
interface TrackedModel {
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
```

### ModelState (`src/interfaces.ts`)
```typescript
interface ModelState {
  provider: string;
  modelId: string;
  isAvailable: boolean;
  lastChecked: Date;
  lastSuccess?: Date;
  lastError?: Date;
  errorCount: number;
  consecutiveFailures: number;
  isRateLimited: boolean;
  rateLimitReset?: Date;
  isFreeTier: boolean;
  avgLatencyMs?: number;
  timeoutCount: number;
  isDead?: boolean;
  deadReason?: string;
  deadSince?: Date;
}
```

---

## Gateway Endpoints

Currently implemented in `src/gateway/server.ts`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions with auto-routing |
| `/v1/models` | GET | List available models |
| `/v1/models?free=true` | GET | List only free tier models |
| `/v1/models?refresh=true` | GET | Rescan providers for latest availability |
| `/v1/freemodels` | GET | List free tier models with extended metadata |
| `/v1/freemodels?probe=true` | GET | Probe free providers for live availability |
| `/health` | GET | Health check |
| `/quotas` | GET | Quota info (stub) |

**Free Models Response Format:**
```json
{
  "object": "list",
  "data": [{
    "id": "llama-3.1-8b-instant",
    "object": "model",
    "owned_by": "groq",
    "is_free": true,
    "is_available": true,
    "avg_latency_ms": 450,
    "is_rate_limited": false,
    "error_count": 0,
    "timeout_count": 0
  }]
}
```

**Request Routing:**
- `model: "auto"` - Intelligent routing to best available provider
- `model: "provider:model"` - Specific provider/model
- Falls back through available models on failure

---

## What Was Discovered During Implementation

### 1. Cohere & Cloudflare Batch Mode Failures
**Root Cause:** Singleton pattern caching wrong ModelDiscovery instance

### 2. Cloudflare Has No `/v1/models` Endpoint
**Solution:** Uses hardcoded `defaultModels` array in model-discovery.ts

### 3. Two ModelInfo Interfaces Exist
- `ModelInfo` in interfaces.ts (basic model info)
- `TrackedModel` in model-manager.ts (tracked model state)
**Solution:** Use `TrackedModel` for gateway operations

### 4. Dead Model Detection
Need to check for: "retired", "deprecated", "no longer available", "model not found", "does not exist", "invalid model", "404"

---

## Implementation Roadmap (from PHASES.md)

| Phase | Priority | Status | Description |
|-------|----------|--------|-------------|
| 1 | Critical | ✅ Complete | Fix type errors & stabilize build |
| 2 | High | ✅ Complete | Circuit breaker implementation |
| 2.5 | High | ✅ Complete | `/v1/freemodels` gateway endpoint |
| 3 | High | 🔜 Next | Smart routing (priority, latency, cost) |
| 4 | Medium | Pending | Complete OpenAI compatibility |
| 5 | Medium | Pending | Observability & production readiness |
| 6 | Future | Pending | Client SDK / Docker deployment |

---

## Next Steps (Phase 3: Smart Routing)

### Goals:
1. Create routing strategies (priority, least-latency, cost-aware, fallback)
2. Enhance `/v1/chat/completions` with better routing logic
3. Add provider health scoring
4. Integrate circuit breakers into routing decisions

### Implementation Plan:
1. Create `src/gateway/router.ts` with:
   - Priority-based routing
   - Least-latency routing
   - Cost-aware routing (prefer free)
   - Fallback chain
   - Circuit breaker integration

2. Enhance server.ts:
   - Use circuit breakers in `routeToBestProvider`
   - Add request timeout handling per-provider
   - Integrate health scoring into model selection

3. Add provider health scoring:
   - Latency EMA
   - Success rate
   - Circuit breaker state

---

## Running the Gateway

```bash
# Build
cd quotas
npm run build

# Start gateway
node dist/cli.js serve --port 3000
# or
npx opencode-quotas serve --port 3000

# Test health endpoint
curl http://localhost:3000/health

# Test models endpoint
curl http://localhost:3000/v1/models

# Test free models endpoint
curl http://localhost:3000/v1/freemodels

# Test chat completions
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Configuration

Gateway config (in `src/gateway/server.ts`):
```typescript
interface GatewayConfig {
  port: number;           // 3000
  host: string;          // localhost
  requestTimeout: number; // 30000ms
  maxRetries: number;    // 3
  retryDelay: number;   // 1000ms
}
```

---

## ESM Module Resolution Fixes

Several source files were missing `.js` extensions in imports (required for ESM). Fixed files:
- `src/discovery/index.ts` - Added `.js` to re-exports
- `src/discovery/balance-checker.ts` - Fixed relative imports
- `src/discovery/model-discovery.ts` - Fixed relative imports
- `src/state/model-state.ts` - Fixed relative imports
- `src/commands/models.ts` - Fixed relative imports
- `src/models/model-manager.ts` - Fixed relative imports

---

## Dependencies

Key dependencies (from package.json):
- `typescript` - TypeScript compiler
- `node` - Runtime (v18+)
- `@opencode-ai/plugin` - Plugin SDK
- `@opencode-ai/sdk` - OpenCode SDK
- Standard library: `http`, `https`, `fs/promises`, `path`, `os`

---

## Notes for Integration

1. **State File:** Model states are stored in `~/.config/opencode/model-states.json`
2. **No Database:** Uses file-based persistence (JSON)
3. **Singleton Pattern:** ModelStateTracker uses singleton instance
4. **Circuit Breakers:** In-memory only (reset on restart)
5. **No Auth:** Gateway currently has no authentication
6. **CORS:** Enabled for all origins (`Access-Control-Allow-Origin: *`)
7. **API Keys:** Required per-provider (env vars or config files)

---

## Known Issues

1. **No API Keys Configured:** Gateway shows 0 models without provider API keys
2. **Circuit Breakers Not Used in Routing:** Phase 3 work needed
3. **No Streaming Support:** Chat completions don't support streaming yet

---

## Contact / Context

For questions or context:
- See `PHASES.md` for full implementation plan
- See `src/gateway/server.ts` for API implementation
- See `src/gateway/circuit-breaker.ts` for circuit breaker logic
- See `src/state/model-state.ts` for state management

**Last Updated:** Phase 2.5 Complete (/freemodels endpoint)
**Build Status:** ✅ PASSING
