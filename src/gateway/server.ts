/**
 * OpenCode Enhanced Quotas - API Gateway Server
 * Provides OpenAI-compatible API for routing requests to available providers
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { getModelDiscovery } from '../discovery/index.js';
import { getProber, getApiKey, PROVIDER_CAPABILITIES } from '../probe/prober.js';
import { createModelManager, TrackedModel } from '../models/model-manager.js';
import type { 
  ProviderDiscoveryConfig, 
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelListResponse
} from '../interfaces.js';

export interface GatewayConfig {
  port: number;
  host: string;
  requestTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

const DEFAULT_CONFIG: GatewayConfig = {
  port: 3000,
  host: 'localhost',
  requestTimeout: 10000,  // 10s per request for faster failover
  maxRetries: 3,
  retryDelay: 1000
};

// Known working models - prioritized for reliability
const KNOWN_WORKING_MODELS: { provider: string; modelId: string; priority: number }[] = [
  // Cerebras - very fast, reliable
  { provider: 'cerebras', modelId: 'llama3.1-8b', priority: 1 },
  
  // OpenRouter - free models
  { provider: 'openrouter', modelId: 'openrouter/free', priority: 2 },
  
  // Mistral
  { provider: 'mistral', modelId: 'mistral-small-latest', priority: 3 },
  
  // Together
  { provider: 'together', modelId: 'meta-llama/Llama-3-8b-chat-hf', priority: 4 },
  
  // DeepInfra
  { provider: 'deepinfra', modelId: 'meta-llama/Llama-3-8b-chat-hf', priority: 5 },
];

interface RouteResult {
  provider: string;
  model: string;
  targetUrl: string;
  apiKey: string;
  headers: Record<string, string>;
}

export class ApiGateway {
  private server: http.Server | null = null;
  private config: GatewayConfig;
  private modelManager: ReturnType<typeof createModelManager>;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    const discovery = getModelDiscovery(async (providerId: string) => {
      return getApiKey(providerId);
    });
    
    const prober = getProber();
    this.modelManager = createModelManager(discovery, prober);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      
      this.server.listen(this.config.port, this.config.host, async () => {
        console.log(`🚀 API Gateway running on http://${this.config.host}:${this.config.port}`);
        console.log(`📍 Endpoints:`);
        console.log(`   - POST /v1/chat/completions`);
        console.log(`   - GET  /v1/models`);
        console.log(`   - GET  /v1/models?free=true`);
        console.log(`   - GET  /v1/freemodels`);
        console.log(`   - GET  /health`);
        console.log(`   - GET  /quotas`);
        
        // Initial model discovery (don't wait for it)
        this.initialDiscovery().catch(err => {
          console.warn('Initial discovery failed:', err.message);
        });
        
        resolve();
      });

      this.server.on('error', reject);
      
      // Start background health checks
      this.startHealthChecks();
    });
  }

  private async initialDiscovery(): Promise<void> {
    console.log('🔍 Performing initial model discovery...');
    
    // Get all providers that support probing and have API keys
    const probeableProviders = PROVIDER_CAPABILITIES
      .filter(c => c.supportsProbe)
      .map(c => c.id);
    
    // Check which providers have API keys
    const providersWithKeys: string[] = [];
    for (const provider of probeableProviders) {
      const key = await getApiKey(provider);
      if (key) {
        providersWithKeys.push(provider);
      }
    }
    
    if (providersWithKeys.length > 0) {
      console.log(`📋 Found API keys for: ${providersWithKeys.join(', ')}`);
      
      // Quick discovery without full probing - just get model lists
      const discovery = getModelDiscovery(async (p) => getApiKey(p));
      let totalModels = 0;
      
      for (const provider of providersWithKeys) {
        try {
          const result = await discovery.discoverModels(provider);
          if (result.models.length > 0) {
            totalModels += result.models.length;
            // Add models to state tracker as available
            for (const model of result.models) {
              this.modelManager.recordSuccess(provider, model.id, 0);
            }
          }
        } catch (err) {
          // Silently skip providers that fail
        }
      }
      
      console.log(`✅ Discovered ${totalModels} models from ${providersWithKeys.length} providers`);
    }
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('🔌 API Gateway stopped');
          resolve();
        });
      });
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      switch (url.pathname) {
        case '/v1/chat/completions':
          if (req.method === 'POST') {
            await this.handleChatCompletion(req, res);
          } else {
            this.sendError(res, 405, 'Method not allowed');
          }
          break;
          
        case '/v1/models':
          if (req.method === 'GET') {
            await this.handleListModels(req, res, url);
          } else {
            this.sendError(res, 405, 'Method not allowed');
          }
          break;

        case '/v1/freemodels':
          if (req.method === 'GET') {
            await this.handleFreeModels(req, res, url);
          } else {
            this.sendError(res, 405, 'Method not allowed');
          }
          break;
          
        case '/health':
          await this.handleHealth(req, res);
          break;
          
        case '/quotas':
          await this.handleQuotas(req, res);
          break;
          
        default:
          this.sendError(res, 404, 'Not found');
      }
    } catch (error) {
      console.error('Gateway error:', error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  private async handleChatCompletion(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.parseBody<ChatCompletionRequest>(req);
    
    if (!body || !body.messages || body.messages.length === 0) {
      this.sendError(res, 400, 'Invalid request: messages required');
      return;
    }

    const requestedModel = body.model || 'auto';
    
    // If user specified "auto", let us route intelligently
    if (requestedModel === 'auto') {
      await this.routeToBestProvider(body, res);
    } else {
      // User specified a specific model
      await this.routeToSpecificModel(requestedModel, body, res);
    }
  }

  private async routeToBestProvider(
    body: ChatCompletionRequest, 
    res: http.ServerResponse
  ): Promise<void> {
    // Get available models
    const allModels = await this.modelManager.getAvailableModels();
    
    if (allModels.length === 0) {
      this.sendError(res, 503, 'No providers available');
      return;
    }

    // Prioritize known working models
    const prioritizedModels: TrackedModel[] = [];
    const seenKeys = new Set<string>();
    
    // First add known working models that have API keys
    for (const known of KNOWN_WORKING_MODELS.sort((a, b) => a.priority - b.priority)) {
      const key = `${known.provider}:${known.modelId}`;
      const model = allModels.find(m => 
        m.provider === known.provider && 
        (m.modelId === known.modelId || m.modelId.endsWith(known.modelId))
      );
      if (model && !seenKeys.has(key)) {
        prioritizedModels.push(model);
        seenKeys.add(key);
      }
    }
    
    // Then add remaining models
    for (const model of allModels) {
      const key = `${model.provider}:${model.modelId}`;
      if (!seenKeys.has(key)) {
        prioritizedModels.push(model);
        seenKeys.add(key);
      }
    }

    // Try each model in priority order
    let attempts = 0;
    const maxAttempts = 20; // Don't try forever
    
    for (const model of prioritizedModels) {
      if (attempts >= maxAttempts) break;
      attempts++;
      
      const startTime = Date.now();
      try {
        const result = await this.proxyRequest(model, body, res);
        if (result) {
          // Success! Record it
          const latencyMs = Date.now() - startTime;
          this.modelManager.recordSuccess(model.provider, model.modelId, latencyMs);
          return;
        }
      } catch (error) {
        console.log(`❌ Failed to route to ${model.provider}/${model.modelId}:`, error);
        this.modelManager.recordError(model.provider, model.modelId, 'endpoint_down');
        continue; // Try next provider
      }
    }

    this.sendError(res, 503, 'All providers failed');
  }

  private async routeToSpecificModel(
    modelId: string,
    body: ChatCompletionRequest,
    res: http.ServerResponse
  ): Promise<void> {
    // Find the model
    const models = await this.modelManager.getAvailableModels();
    const model = models.find(m => m.modelId === modelId || m.modelId.endsWith(`/${modelId}`));
    
    if (!model) {
      this.sendError(res, 404, `Model not found: ${modelId}`);
      return;
    }

    if (!model.isAvailable) {
      this.sendError(res, 503, `Model ${modelId} is currently unavailable`);
      return;
    }

    try {
      const startTime = Date.now();
      await this.proxyRequest(model, body, res);
      const latencyMs = Date.now() - startTime;
      this.modelManager.recordSuccess(model.provider, model.modelId, latencyMs);
    } catch (error) {
      console.error(`Failed to proxy to ${modelId}:`, error);
      this.modelManager.recordError(model.provider, model.modelId, 'endpoint_down');
      this.sendError(res, 502, 'Provider error');
    }
  }

  private async proxyRequest(
    model: TrackedModel,
    body: ChatCompletionRequest,
    res: http.ServerResponse
  ): Promise<boolean> {
    const route = await this.buildRoute(model, body);
    
    if (!route) {
      return false;
    }

    // Replace model name with actual model ID for the provider
    const bodyWithModel = { ...body, model: route.model };

    // Transform request for specific provider if needed
    const transformedBody = this.transformRequest(bodyWithModel, route.provider);
    
    // Make the request
    const response = await this.makeProviderRequest(route, transformedBody);
    
    if (!response) {
      return false;
    }

    // Transform response back to OpenAI format
    const openaiResponse = this.transformResponse(response, route.provider);
    
    // Send response
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(openaiResponse));
    
    return true;
  }

  private async buildRoute(model: TrackedModel, body: ChatCompletionRequest): Promise<RouteResult | null> {
    const apiKey = await getApiKey(model.provider);
    
    if (!apiKey) {
      console.log(`No API key for ${model.provider}`);
      return null;
    }

    const config = PROVIDER_CAPABILITIES.find(c => c.id === model.provider);
    if (!config) {
      return null;
    }

    let targetUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    // Build provider-specific URL
    switch (model.provider) {
      case 'groq':
        targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
        break;
      case 'openrouter':
        targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
        headers['HTTP-Referer'] = 'https://opencode.ai';
        break;
      case 'together':
        targetUrl = 'https://api.together.xyz/v1/chat/completions';
        break;
      case 'deepinfra':
        targetUrl = 'https://api.deepinfra.com/v1/openai/chat/completions';
        break;
      case 'mistral':
        targetUrl = 'https://api.mistral.ai/v1/chat/completions';
        break;
      case 'fireworks':
        targetUrl = 'https://api.fireworks.ai/inference/v1/chat/completions';
        break;
      case 'cohere':
        targetUrl = 'https://api.cohere.ai/v2/chat';
        break;
      case 'cloudflare':
        const accountId = await this.getCloudflareAccountId();
        if (!accountId) return null;
        targetUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model.modelId}`;
        break;
      default:
        if (!config.probeEndpoint) {
          return null;
        }
        targetUrl = `${config.probeEndpoint.replace('/chat/completions', '')}/chat/completions`;
    }

    return {
      provider: model.provider,
      model: model.modelId,
      targetUrl,
      apiKey,
      headers
    };
  }

  private async getCloudflareAccountId(): Promise<string | null> {
    try {
      const { readProviderConfig } = await import('../providers/provider-utils.js');
      const config = await readProviderConfig('cloudflare-auth.json');
      const accountId = config?.accountId;
      return typeof accountId === 'string' ? accountId : null;
    } catch {
      return null;
    }
  }

  private transformRequest(body: ChatCompletionRequest, provider: string): any {
    // Most providers accept OpenAI format, but some need transformation
    switch (provider) {
      case 'cohere':
        // Cohere uses different format
        return {
          model: body.model,
          messages: body.messages,
          max_tokens: body.max_tokens || 1024,
          temperature: body.temperature || 0.7,
          stream: body.stream || false
        };
      default:
        return body;
    }
  }

  private transformResponse(response: any, provider: string): ChatCompletionResponse {
    // Transform provider-specific response to OpenAI format
    switch (provider) {
      case 'cloudflare':
        // Cloudflare returns { result: { response: "..." } }
        if (response.result?.response) {
          return {
            id: `cf-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: response.model || 'unknown',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: response.result.response
              },
              finish_reason: 'stop'
            }],
            usage: response.result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          };
        }
        return response;
      default:
        return response;
    }
  }

  private async makeProviderRequest(
    route: RouteResult, 
    body: any
  ): Promise<any | null> {
    return new Promise((resolve) => {
      const url = new URL(route.targetUrl);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...route.headers,
          'Content-Length': Buffer.byteLength(JSON.stringify(body))
        },
        timeout: this.config.requestTimeout
      };

      const client = url.protocol === 'https:' ? https : http;
      
      const req = client.request(options, (res: http.IncomingMessage) => {
        let data = '';
        
        res.on('data', (chunk: Buffer) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const json = JSON.parse(data);
              resolve(json);
            } else {
              // Only log non-404 errors verbosely
              if (res.statusCode !== 404) {
                console.log(`Provider returned ${res.statusCode}: ${data.slice(0, 200)}`);
              }
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', (err: Error) => {
        console.error('Request error:', err);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  private async handleListModels(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const onlyFree = url.searchParams.get('free') === 'true';
    const onlyAvailable = url.searchParams.get('available') !== 'false';
    const refresh = url.searchParams.get('refresh') === 'true';
    
    let models: TrackedModel[];
    
    if (refresh) {
      const probeableProviders = PROVIDER_CAPABILITIES
        .filter(c => c.supportsProbe && (onlyFree ? c.isFreeTier : true))
        .map(c => c.id);
      models = await this.modelManager.scanAllProviders(probeableProviders);
      if (onlyFree) {
        models = models.filter(m => m.isFree);
      }
    } else if (onlyFree) {
      models = await this.modelManager.getFreeModels();
    } else {
      models = await this.modelManager.getAvailableModels({
        onlyAvailable,
        excludeRateLimited: true,
        excludeTimeouts: true,
      });
    }
    
    const response = this.buildModelListResponse(models);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private async handleFreeModels(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const refresh = url.searchParams.get('refresh') === 'true';
    const probe = url.searchParams.get('probe') === 'true';
    
    let models: TrackedModel[];
    
    if (refresh || probe) {
      const probeableProviders = PROVIDER_CAPABILITIES
        .filter(c => c.supportsProbe && c.isFreeTier)
        .map(c => c.id);
      models = await this.modelManager.scanAllProviders(probeableProviders);
      models = models.filter(m => m.isFree);
    } else {
      models = await this.modelManager.getFreeModels();
    }
    
    const response = this.buildModelListResponse(models, true);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private buildModelListResponse(models: TrackedModel[], includeMetadata: boolean = false): any {
    const baseResponse = {
      object: 'list' as const,
      data: models.map(m => {
        const base: any = {
          id: m.modelId,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: m.provider,
          permission: [],
          root: m.modelId,
          parent: null
        };
        
        if (includeMetadata) {
          base.is_free = m.isFree;
          base.is_available = m.isAvailable;
          base.avg_latency_ms = m.avgLatencyMs;
          base.is_rate_limited = m.isRateLimited;
          if (m.rateLimitReset) {
            base.rate_limit_reset = m.rateLimitReset.toISOString();
          }
          base.error_count = m.errorCount;
          base.timeout_count = m.timeoutCount;
        }
        
        return base;
      })
    };
    
    return baseResponse;
  }

  private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const models = await this.modelManager.getAvailableModels();
    
    const health = {
      status: 'healthy',
      providers: [...new Set(models.map(m => m.provider))],
      available_models: models.length,
      timestamp: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(health));
  }

  private async handleQuotas(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Return quota information for all providers
    // This would integrate with the quota service
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'Quota endpoint - integrate with quota service',
      timestamp: new Date().toISOString()
    }));
  }

  private async parseBody<T>(req: http.IncomingMessage): Promise<T | null> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  private sendError(res: http.ServerResponse, code: number, message: string): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(code);
    res.end(JSON.stringify({
      error: {
        message,
        type: 'api_error',
        code
      }
    }));
  }

  private startHealthChecks(): void {
    // Periodic background health checks
    this.healthCheckInterval = setInterval(async () => {
      try {
        const probeableProviders = PROVIDER_CAPABILITIES
          .filter(c => c.supportsProbe)
          .map(c => c.id);
        await this.modelManager.scanAllProviders(probeableProviders);
      } catch (error) {
        console.error('Background health check failed:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }
}

// Export factory function
export function createApiGateway(config?: Partial<GatewayConfig>): ApiGateway {
  return new ApiGateway(config);
}
