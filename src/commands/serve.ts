/**
 * OpenCode Enhanced Quotas - Gateway Serve Command
 * Start the API Gateway server
 */

import { createApiGateway } from '../gateway/index.js';
import type { GatewayConfig } from '../gateway/index.js';

interface ServeOptions {
  port?: number;
  host?: string;
}

export async function serveCommand(options: ServeOptions = {}): Promise<void> {
  const config: Partial<GatewayConfig> = {
    port: options.port || 3000,
    host: options.host || 'localhost'
  };

  console.log('🚀 Starting OpenCode Enhanced Quotas API Gateway...\n');
  console.log('Configuration:');
  console.log(`  Port: ${config.port}`);
  console.log(`  Host: ${config.host}`);
  console.log('');

  const gateway = createApiGateway(config);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await gateway.start();
  } catch (error) {
    console.error('❌ Failed to start gateway:', error);
    process.exit(1);
  }
}

export function showServeHelp(): void {
  console.log(`
OpenCode Enhanced Quotas - Gateway Server

Start an OpenAI-compatible API Gateway server that routes requests
to available providers based on quota, cost, and health status.

USAGE:
  opencode-quotas serve [OPTIONS]

OPTIONS:
  --port <number>    Port to listen on (default: 3000)
  --host <address>   Host address to bind to (default: localhost)

EXAMPLES:
  opencode-quotas serve                    # Start on default port 3000
  opencode-quotas serve --port 8080        # Start on port 8080
  opencode-quotas serve --host 0.0.0.0     # Bind to all interfaces

ENDPOINTS:
  POST /v1/chat/completions    Chat completion endpoint (OpenAI-compatible)
  GET  /v1/models              List available models
  GET  /health                 Health check endpoint
  GET  /v1/models?free=true    List only free models

The gateway automatically:
  • Routes to best available provider
  • Retries failed requests with fallback providers
  • Tracks model status and excludes dead endpoints
  • Respects rate limits and quotas
`);
}
