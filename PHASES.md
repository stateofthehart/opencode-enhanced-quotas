# API Gateway Implementation Plan

## Executive Summary

Build an intelligent API Gateway that routes LLM requests to free providers with automatic failover, dead model exclusion, and OpenAI-compatible endpoints. The gateway will serve as the backend for your homeservices AI assistant.

---

## Research Findings

### Current Implementation State

**What's Already Built:**
- `src/gateway/server.ts` (527 lines) - HTTP server with OpenAI-compatible endpoints
- `src/models/model-manager.ts` - Model discovery and state tracking
- `src/state/model-state.ts` - Persistent file-based state tracking
- `src/commands/models.ts` - `/mymodels` and `/freemodels` CLI commands
- `src/commands/serve.ts` - CLI serve command

**Implemented Endpoints:**
- `POST /v1/chat/completions` - Chat completions with auto-routing
- `GET /v1/models` - List available models
- `GET /health` - Health check
- `GET /quotas` - Quota info (stub)

**Supported Providers:**
Groq, OpenRouter, Together, DeepInfra, Mistral, Fireworks, Cohere (with transformation), Cloudflare (with transformation)

### The 16 Build Errors

| Error | Location | Root Cause |
|-------|----------|------------|
| Import wrong type | `models.ts:5` | Imports `ModelInfo` but should use `TrackedModel` |
| Type mismatch | `server.ts:181,217` | `TrackedModel` not assignable to `ModelInfo` |
| Wrong arg count | `server.ts:184,218` | `recordSuccess(provider, modelId)` called with 2 args, needs 3 |
| Wrong arg count | `model-manager.ts:293` | `recordError` implemented with 4 args, interface expects 3 |
| Missing property | `server.ts:211,212` | Uses `status` but should use `isAvailable` |
| Missing property | `server.ts:304,312` | Uses `modelId` but `ModelInfo` has `id` |
| Implicit any | `server.ts:395,398,417` | HTTP callback params lack types |
| Possibly undefined | `server.ts:307,323` | Missing null checks |

**Core Problem:** Two incompatible model types exist:
- `ModelInfo` (interfaces.ts): Uses `.id` field
- `TrackedModel` (model-manager.ts): Uses `.modelId` field

### Provider API Compatibility

**Fully OpenAI-Compatible (Just URL/Auth Passthrough):**
| Provider | Base URL | Notes |
|----------|----------|-------|
| Groq | `api.groq.com/openai/v1` | Rate limits via headers |
| Fireworks | `api.fireworks.ai/inference/v1` | Returns usage in streaming |
| HuggingFace | `router.huggingface.co/v1` | Model format: `model_id:provider` |
| Cerebras | `api.cerebras.ai/v1` | Fastest (1800 tok/s) |
| NVIDIA NIM | `integrate.api.nvidia.com/v1` | Self-hosted option |
| OpenRouter | `openrouter.ai/api/v1` | Provider selection via `provider.order` |
| Gemini | `generativelanguage.googleapis.com/v1beta/openai/` | Uses `reasoning_effort` param |
| Cloudflare | `api.cloudflare.com/client/v4/accounts/{id}/ai/v1` | Uses `@cf/` prefix |

**Requires Transformation:**
- **Cohere v2**: Different param names (`p` vs `top_p`), different default temperature (0.3 vs 1.0), different response structure

---

## Phased Implementation Plan

### Phase 1: Fix Type Errors & Stabilize Build (Priority: Critical)

**Goal:** Get the gateway compiling and running

**Tasks:**
1. Fix type imports in `gateway/server.ts`:
   - Import `TrackedModel` from model-manager, not `ModelInfo` from interfaces
   - Use `.modelId` field consistently

2. Fix method signatures:
   - `recordSuccess(provider, modelId, latencyMs)` - 3 required args
   - Align `model-manager.ts:293` with interface (3 args)

3. Add explicit types:
   - HTTP callbacks: `req: IncomingMessage, res: ServerResponse`
   - Add null checks for `probeEndpoint`

4. Test build: `npm run build`

**Estimated:** 30-60 minutes

---

### Phase 2: Enhance Model State Management (Priority: High)

**Goal:** Robust per-model state tracking with circuit breakers

**Tasks:**
1. Implement CircuitBreaker class in `src/gateway/circuit-breaker.ts`:
   - States: CLOSED → OPEN → HALF_OPEN
   - Failure threshold: 5 failures
   - Recovery timeout: 30 seconds
   - Success threshold: 3 successes

2. Add per-model circuit breakers to ModelStateTracker:
   - Track circuit state per (provider, modelId) pair
   - Auto-recover after timeout

3. Implement retry logic with exponential backoff

---

### Phase 3: Implement Smart Routing (Priority: High)

**Goal:** Route requests intelligently based on availability, latency, and cost

**Tasks:**
1. Create routing strategies:
   - **Priority-based**: Try preferred providers first
   - **Least-latency**: Route to fastest responding
   - **Cost-aware**: Prefer free tier
   - **Fallback chain**: Try next provider on failure

2. Enhance `/v1/chat/completions`:
   - Support `model: "auto"` for intelligent routing
   - Support `model: "provider:model"` for specific routing
   - Add request timeout handling per-provider

3. Add provider health scoring

---

### Phase 4: Complete OpenAI Compatibility (Priority: Medium)

**Goal:** Full OpenAI API compatibility for seamless tool integration

**Tasks:**
1. Implement missing endpoints:
   - `GET /v1/models/{model}` - Get specific model
   - `POST /v1/embeddings` - Embeddings endpoint

2. Enhance streaming support:
   - Proper SSE headers
   - Usage in streaming responses
   - Handle stream interruptions

3. Error format standardization

4. Add authentication and rate limiting per client

---

### Phase 5: Observability & Production Readiness (Priority: Medium)

**Goal:** Make it robust and debuggable

**Tasks:**
1. Structured logging
2. Metrics collection
3. Health endpoints
4. Environment-based configuration

---

### Phase 6: Client SDK / Integration (Priority: Future)

**Goal:** Easy integration for homeservices

**Tasks:**
1. JavaScript/TypeScript client SDK
2. Webhook support
3. Docker Compose deployment

---

## Summary Timeline

| Phase | Priority | Estimate |
|-------|----------|----------|
| 1. Fix Build Errors | Critical | 30-60 min |
| 2. Circuit Breakers | High | 1-2 hours |
| 3. Smart Routing | High | 2-3 hours |
| 4. OpenAI Compatibility | Medium | 2-3 hours |
| 5. Observability | Medium | 2-3 hours |
| 6. Client SDK | Future | 3-4 hours |

**Total:** ~11-17 hours for core functionality
