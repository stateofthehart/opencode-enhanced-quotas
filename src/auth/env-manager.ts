import { readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Mapping of env var names to OpenCode provider config
export const ENV_PROVIDER_MAP: Record<string, { provider: string; field: string }> = {
  // API Key providers (alphabetical)
  ANTHROPIC_API_KEY: { provider: "anthropic", field: "key" },
  CEREBRAS_API_KEY: { provider: "cerebras", field: "key" },
  COHERE_API_KEY: { provider: "cohere", field: "key" },
  DEEPINFRA_API_KEY: { provider: "deepinfra", field: "key" },
  FIREWORKS_API_KEY: { provider: "fireworks-ai", field: "key" },
  GEMINI_API_KEY: { provider: "google", field: "key" },
  GROQ_API_KEY: { provider: "groq", field: "key" },
  HUGGINGFACE_API_KEY: { provider: "huggingface", field: "key" },
  MINIMAX_API_KEY: { provider: "minimax", field: "key" },
  MISTRAL_API_KEY: { provider: "mistral", field: "key" },
  NVIDIA_API_KEY: { provider: "nvidia", field: "key" },
  OPENROUTER_API_KEY: { provider: "openrouter", field: "key" },
  TOGETHER_API_KEY: { provider: "together", field: "key" },
  ZAI_API_KEY: { provider: "zai", field: "key" },
  
  // Special cases
  CLOUDFLARE_API_TOKEN: { provider: "cloudflare-workers-ai", field: "apiToken" },
  CLOUDFLARE_ACCOUNT_ID: { provider: "cloudflare-workers-ai", field: "accountId" },
};

// OAuth providers that cannot be imported from env (need browser login)
export const OAUTH_PROVIDERS = [
  "anthropic",
  "github-copilot", 
  "google",
  "cursor",
];

// Reverse mapping: provider -> env var name
export function getEnvVarForProvider(provider: string, field: string): string | null {
  for (const [envVar, config] of Object.entries(ENV_PROVIDER_MAP)) {
    if (config.provider === provider && config.field === field) {
      return envVar;
    }
  }
  return null;
}

// Parse .env file content
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Handle export KEY=value
    const withoutExport = trimmed.replace(/^export\s+/, '');
    
    // Find first =
    const equalIndex = withoutExport.indexOf('=');
    if (equalIndex === -1) continue;
    
    const key = withoutExport.substring(0, equalIndex).trim();
    let value = withoutExport.substring(equalIndex + 1).trim();
    
    // Strip quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    result[key] = value;
  }
  
  return result;
}

// Read OpenCode auth.json
async function readOpenCodeAuth(): Promise<Record<string, unknown>> {
  const authPath = join(homedir(), '.local/share/opencode/auth.json');
  try {
    const content = await readFile(authPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// Write OpenCode auth.json with backup
async function writeOpenCodeAuth(auth: Record<string, unknown>): Promise<void> {
  const authDir = join(homedir(), '.local/share/opencode');
  const authPath = join(authDir, 'auth.json');
  
  // Create backup if file exists
  if (existsSync(authPath)) {
    const timestamp = Date.now();
    const backupPath = join(authDir, `auth.json.bak.${timestamp}`);
    await copyFile(authPath, backupPath);
  }
  
  // Write updated auth
  await writeFile(authPath, JSON.stringify(auth, null, 2) + '\n', 'utf-8');
}

export interface ImportResult {
  imported: string[];
  oauth: string[];
  skipped: string[];
  backupPath?: string;
}

export interface ExportOptions {
  mask?: boolean;
  includeOAuth?: boolean;
}

export async function importAuthFromEnv(envPath: string): Promise<ImportResult> {
  const result: ImportResult = {
    imported: [],
    oauth: [],
    skipped: [],
  };
  
  // Read .env file
  const envContent = await readFile(envPath, 'utf-8');
  const envVars = parseEnvFile(envContent);
  
  // Read current auth
  const auth = await readOpenCodeAuth();
  const backupTimestamp = Date.now();
  
  // Track which providers we're importing to
  const providerUpdates: Record<string, Record<string, string>> = {};
  
  for (const [envVar, value] of Object.entries(envVars)) {
    const mapping = ENV_PROVIDER_MAP[envVar];
    if (!mapping) {
      result.skipped.push(envVar);
      continue;
    }
    
    const { provider, field } = mapping;
    
    // Initialize provider entry if needed
    if (!providerUpdates[provider]) {
      providerUpdates[provider] = {};
    }
    
    providerUpdates[provider][field] = value;
  }
  
  // Merge updates into auth
  for (const [provider, fields] of Object.entries(providerUpdates)) {
    // Check if this is an OAuth provider (has refreshToken)
    const existingEntry = auth[provider] as Record<string, unknown> | undefined;
    const hasOAuth = existingEntry && (existingEntry.refreshToken || existingEntry.accessToken);
    
    if (hasOAuth) {
      result.oauth.push(provider);
      continue;
    }
    
    // Merge fields
    if (!auth[provider]) {
      auth[provider] = {};
    }
    Object.assign(auth[provider] as Record<string, unknown>, fields);
    result.imported.push(provider);
  }
  
  // Write updated auth
  if (result.imported.length > 0) {
    await writeOpenCodeAuth(auth);
    result.backupPath = join(homedir(), '.local/share/opencode', `auth.json.bak.${backupTimestamp}`);
  }
  
  return result;
}

export async function exportAuthToEnv(options: ExportOptions = {}): Promise<string> {
  const auth = await readOpenCodeAuth();
  const lines: string[] = [];
  
  lines.push('# Auto-generated by opencode-quotas auth export');
  lines.push('# Import with: opencode-quotas auth import <this-file>');
  lines.push('');
  
  const oauthProviders: string[] = [];
  const apiKeyProviders: string[] = [];
  
  // Process each provider in auth
  for (const [provider, entry] of Object.entries(auth)) {
    if (!entry || typeof entry !== 'object') continue;
    
    const entryObj = entry as Record<string, unknown>;
    
    // Skip OAuth providers (have refreshToken/accessToken)
    if (entryObj.refreshToken || entryObj.accessToken) {
      oauthProviders.push(provider);
      continue;
    }
    
    // Export API keys
    for (const [field, value] of Object.entries(entryObj)) {
      if (typeof value !== 'string') continue;
      if (field === 'refreshToken' || field === 'accessToken') continue;
      
      const envVar = getEnvVarForProvider(provider, field);
      if (envVar) {
        const displayValue = options.mask ? maskValue(value) : value;
        lines.push(`${envVar}=${displayValue}`);
        apiKeyProviders.push(provider);
      }
    }
  }
  
  // Add OAuth comment
  if (oauthProviders.length > 0) {
    lines.push('');
    lines.push('# OAuth providers (require manual login):');
    for (const provider of [...new Set(oauthProviders)]) {
      lines.push(`# ${provider} (use: opencode auth login ${provider})`);
    }
  }
  
  // Add missing common providers comment
  lines.push('');
  lines.push('# Common API key providers (add to import):');
  const commonMissing = ['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'COHERE_API_KEY', 'MISTRAL_API_KEY'];
  for (const envVar of commonMissing) {
    if (!lines.some(l => l.startsWith(`${envVar}=`))) {
      lines.push(`# ${envVar}=your_key_here`);
    }
  }
  
  return lines.join('\n') + '\n';
}

function maskValue(value: string): string {
  if (value.length <= 8) return '***';
  return value.substring(0, 4) + '***' + value.substring(value.length - 4);
}
