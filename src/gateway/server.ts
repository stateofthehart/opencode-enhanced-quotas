/**
 * OpenCode Enhanced Quotas - API Gateway Server
 * Provides OpenAI-compatible API for routing requests to available providers
 */

import http from 'http';
import { URL } from 'url';
import { getModelDiscovery } from '../discovery/index.js';
import { getProber, getApiKey } from '../probe/prober.js';
import { createModelManager, TrackedModel } from '../models/model-manager.js';
import type { 
  ProviderDiscoveryConfig, 
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelListResponse
} from '../interfaces.js';
import { PROVIDER_CAPABILITIES } from '../probe/prober.js';

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
  requestTimeout: 30000,
  maxRetries: 3,
  retryDelay: 1000
};

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
      
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`🚀 API Gateway running on http://${this.config.host}:${this.config.port}`);
        console.log(`📍 Endpoints:`);
        console.log(`   - POST /v1/chat/completions`);
        console.log(`   - GET  /v1/models`);
        console.log(`   - GET  /health`);
        console.log(`   - GET  /quotas`);
        resolve();
      });

      this.server.on('error', reject);
      
      // Start background health checks
      this.startHealthChecks();
    });
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
            await this.handleListModels(req, res);
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
    // Get available models sorted by latency and status
    const models = await this.modelManager.getAvailableModels();
    
    if (models.length === 0) {
      this.sendError(res, 503, 'No providers available');
      return;
    }

    // Try each model in order (already sorted by quality)
    for (const model of models) {
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

    // Transform request for specific provider if needed
    const transformedBody = this.transformRequest(body, route.provider);
    
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

      const client = url.protocol === 'https:' ? require('https') : require('http');
      
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
              console.log(`Provider returned ${res.statusCode}: ${data}`);
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

  private async handleListModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const models = await this.modelManager.getAvailableModels();
    
    const response: ModelListResponse = {
      object: 'list',
      data: models.map(m => ({
        id: m.modelId,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: m.provider,
        permission: [],
        root: m.modelId,
        parent: null
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(response));
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
