import { createModelManager, TrackedModel } from '../models/model-manager.js';
import { getModelDiscovery } from '../discovery/index.js';
import { getProber } from '../probe/index.js';
import { PROVIDER_CAPABILITIES } from '../probe/prober.js';

interface RenderOptions {
  showLatency?: boolean;
  showErrors?: boolean;
  showRateLimits?: boolean;
  maxModels?: number;
}

export async function showMyModels(args: string[] = []): Promise<void> {
  const verbose = args.includes('--verbose') || args.includes('-v');
  const refresh = args.includes('--refresh') || args.includes('-r');
  const onlyFree = args.includes('--free') || args.includes('-f');
  
  console.log('\n📊 My Available Models\n');
  
  const discovery = getModelDiscovery(async (providerId: string) => {
    const { getApiKey } = await import('../probe/prober.js');
    return getApiKey(providerId);
  });
  
    const prober = getProber();
    const manager = createModelManager(discovery, prober, {
    maxConcurrentProbes: 5,
    probeTimeout: 30000,
  });

  let models: TrackedModel[];
  
  if (refresh) {
    console.log('🔄 Refreshing model availability...\n');
    const probeableProviders = PROVIDER_CAPABILITIES
      .filter((c) => c.supportsProbe)
      .map((c) => c.id);
    models = await manager.scanAllProviders(probeableProviders);
  } else {
    if (onlyFree) {
      models = await manager.getFreeModels();
    } else {
      models = await manager.getAvailableModels({
        excludeRateLimited: true,
        excludeTimeouts: true,
      });
    }
  }

  if (models.length === 0) {
    console.log('❌ No models available. Try running with --refresh to scan providers.');
    return;
  }

  renderModelTable(models, {
    showLatency: true,
    showErrors: verbose,
    showRateLimits: true,
  });

  console.log(`\n📈 Total: ${models.length} models available`);
  console.log(`💡 Tip: Use --free to show only free tier models`);
  console.log(`💡 Tip: Use --refresh to rescan all providers`);
}

export async function showFreeModels(args: string[] = []): Promise<void> {
  const refresh = args.includes('--refresh') || args.includes('-r');
  
  console.log('\n🆓 Free Tier Models\n');
  
  const discovery = getModelDiscovery(async (providerId: string) => {
    const { getApiKey } = await import('../probe/prober.js');
    return getApiKey(providerId);
  });
  
  const prober = getProber();
  const manager = createModelManager(discovery, prober);

  let models: TrackedModel[];
  
  if (refresh) {
    console.log('🔄 Refreshing free model availability...\n');
    const probeableProviders = PROVIDER_CAPABILITIES
      .filter((c) => c.supportsProbe && c.isFreeTier)
      .map((c) => c.id);
    models = await manager.scanAllProviders(probeableProviders);
    models = models.filter((m) => m.isFree);
  } else {
    models = await manager.getFreeModels();
  }

  if (models.length === 0) {
    console.log('❌ No free models available. Try running with --refresh.');
    return;
  }

  // Group by provider
  const byProvider = groupByProvider(models);
  
  for (const [provider, providerModels] of Object.entries(byProvider)) {
    console.log(`\n${provider}:`);
    console.log('─'.repeat(60));
    
    for (const model of providerModels) {
      const status = getStatusEmoji(model);
      const latency = model.avgLatencyMs ? `${model.avgLatencyMs.toFixed(0)}ms` : 'N/A';
      const statusText = getStatusText(model);
      
      console.log(`  ${status} ${model.modelId.padEnd(40)} ${latency.padStart(6)} ${statusText}`);
    }
  }

  console.log(`\n📈 Total: ${models.length} free models across ${Object.keys(byProvider).length} providers`);
}

function renderModelTable(models: TrackedModel[], options: RenderOptions): void {
  // Sort: available first, then by provider
  const sorted = models.sort((a, b) => {
    if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.modelId.localeCompare(b.modelId);
  });

  console.log('┌────────────┬─────────────────────────────────────┬──────────┬─────────────┐');
  console.log('│ Provider   │ Model                               │ Status   │ Latency     │');
  console.log('├────────────┼─────────────────────────────────────┼──────────┼─────────────┤');

  for (const model of sorted) {
    const provider = model.provider.slice(0, 10).padEnd(10);
    const modelId = model.modelId.slice(0, 35).padEnd(35);
    const status = getStatusText(model).slice(0, 8).padEnd(8);
    const latency = model.avgLatencyMs 
      ? `${model.avgLatencyMs.toFixed(0)}ms`.padStart(11)
      : 'N/A'.padStart(11);
    
    console.log(`│ ${provider} │ ${modelId} │ ${status} │ ${latency} │`);
  }

  console.log('└────────────┴─────────────────────────────────────┴──────────┴─────────────┘');
}

function getStatusEmoji(model: TrackedModel): string {
  if (!model.isAvailable) return '❌';
  if (model.isRateLimited) return '⏳';
  if (model.timeoutCount > 0) return '⚠️';
  if (model.isFree) return '🆓';
  return '✅';
}

function getStatusText(model: TrackedModel): string {
  if (!model.isAvailable) return 'unavailable';
  if (model.isRateLimited) return 'rate limit';
  if (model.timeoutCount > 0) return 'timeout';
  if (model.isFree) return 'free';
  return 'paid';
}

function groupByProvider(models: TrackedModel[]): Record<string, TrackedModel[]> {
  return models.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, TrackedModel[]>);
}

export function showModelsHelp(): void {
  console.log(`
📖 Model Management Commands

USAGE:
  opencode-quotas models [OPTIONS]
  opencode-quotas freemodels [OPTIONS]

OPTIONS:
  --refresh, -r     Rescan all providers for latest availability
  --free, -f        Show only free tier models (models command only)
  --verbose, -v     Show detailed error information
  --help, -h        Show this help message

EXAMPLES:
  opencode-quotas models              # Show all available models
  opencode-quotas models --free       # Show only free models
  opencode-quotas models --refresh    # Rescan and show all models
  opencode-quotas freemodels          # Show free models only
  opencode-quotas freemodels -r       # Refresh and show free models

STATUS LEGEND:
  ✅ Available    - Model is ready to use
  🆓 Free         - Free tier model
  ⏳ Rate Limited - Currently rate limited, will retry later
  ⚠️ Timeout      - Recent timeouts, may be unstable
  ❌ Unavailable  - Model is not available
`);
}
