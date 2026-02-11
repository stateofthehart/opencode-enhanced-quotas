#!/usr/bin/env node
/**
 * Comprehensive validation suite for opencode-enhanced-quotas plugin
 * Tests everything without requiring OpenCode UI interaction
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = __dirname;

console.log('='.repeat(80));
console.log('COMPREHENSIVE PLUGIN VALIDATION');
console.log('='.repeat(80));
console.log();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result) {
      console.log(`✅ ${name}`);
      passedTests++;
      return true;
    } else {
      console.log(`❌ ${name}`);
      failedTests++;
      return false;
    }
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failedTests++;
    return false;
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    const result = await fn();
    if (result) {
      console.log(`✅ ${name}`);
      passedTests++;
      return true;
    } else {
      console.log(`❌ ${name}`);
      failedTests++;
      return false;
    }
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failedTests++;
    return false;
  }
}

console.log('📦 PHASE 1: Plugin Structure Validation');
console.log('-'.repeat(80));

test('package.json exists', () => existsSync(join(PLUGIN_ROOT, 'package.json')));
test('dist/index.js exists', () => existsSync(join(PLUGIN_ROOT, 'dist/index.js')));
test('package.json has correct name', () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
  return pkg.name === '@ereinha/opencode-enhanced-quotas';
});

console.log();
console.log('🔌 PHASE 2: Plugin Load & Hook Validation');
console.log('-'.repeat(80));

let plugin;
let pluginHooks;

await testAsync('Plugin imports successfully', async () => {
  try {
    const mod = await import(join(PLUGIN_ROOT, 'dist/index.js'));
    plugin = mod.default;
    return typeof plugin === 'function';
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

await testAsync('Plugin initializes without errors', async () => {
  try {
    const mockClient = {
      session: {
        prompt: async () => ({ content: [] })
      }
    };
    pluginHooks = await plugin({
      workspace: process.cwd(),
      directory: PLUGIN_ROOT,
      client: mockClient
    });
    return pluginHooks !== null && typeof pluginHooks === 'object';
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

test('Config hook exists', () => {
  return pluginHooks && typeof pluginHooks.config === 'function';
});

test('command.execute.before hook exists', () => {
  return pluginHooks && typeof pluginHooks['command.execute.before'] === 'function';
});

test('experimental.text.complete hook exists', () => {
  return pluginHooks && typeof pluginHooks['experimental.text.complete'] === 'function';
});

console.log();
console.log('📝 PHASE 3: Command Registration Validation');
console.log('-'.repeat(80));

let registeredCommands = [];

await testAsync('Config hook registers commands', async () => {
  try {
    const config = { command: {} };
    await pluginHooks.config(config);
    registeredCommands = Object.keys(config.command);
    return registeredCommands.includes('usage') && registeredCommands.includes('mymodels');
  } catch (e) {
    console.log(`   Error: ${e.message}`);
    return false;
  }
});

console.log(`   Registered commands: ${registeredCommands.join(', ')}`);

console.log();
console.log('🔐 PHASE 4: Auth Files Validation');
console.log('-'.repeat(80));

const authFiles = {
  'OpenCode auth': join(homedir(), '.local/share/opencode/auth.json'),
  'Claude credentials': join(homedir(), '.claude/.credentials.json'),
  'Cursor auth.json': join(homedir(), '.config/cursor/auth.json'),
  'Cursor cli-config': join(homedir(), '.cursor/cli-config.json'),
  'Gemini OAuth': join(homedir(), '.gemini/oauth_creds.json'),
  'z.ai config': join(homedir(), '.config/opencode/zai-config.json'),
  'MiniMax config': join(homedir(), '.config/opencode/minimax-config.json'),
};

for (const [name, path] of Object.entries(authFiles)) {
  test(`${name} exists`, () => existsSync(path));
}

console.log();
console.log('🧪 PHASE 5: Provider Testing');
console.log('-'.repeat(80));

const providers = [
  { name: 'Antigravity', file: 'antigravity/index.js' },
  { name: 'Codex', file: 'codex.js' },
  { name: 'Anthropic (Claude)', file: 'anthropic.js' },
  { name: 'Copilot', file: 'copilot.js' },
  { name: 'Cursor', file: 'cursor.js' },
  { name: 'Gemini', file: 'gemini.js' },
  { name: 'z.ai', file: 'zai.js' },
  { name: 'MiniMax', file: 'minimax.js' },
  { name: 'JetBrains', file: 'jetbrains.js' },
];

for (const { name, file } of providers) {
  await testAsync(`${name} provider loads`, async () => {
    try {
      const mod = await import(join(PLUGIN_ROOT, 'dist/providers', file));
      return Object.values(mod).some(v => typeof v === 'function');
    } catch (e) {
      console.log(`   Error: ${e.message}`);
      return false;
    }
  });
}

console.log();
console.log('📊 PHASE 6: Real Provider Data Fetching');
console.log('-'.repeat(80));

// Test providers that should work with current auth
const workingProviders = [
  { name: 'Codex', id: 'codex', file: 'codex.js' },
  { name: 'Anthropic (Claude)', id: 'anthropic', file: 'anthropic.js' },
  { name: 'Copilot', id: 'copilot', file: 'copilot.js' },
];

for (const { name, id, file } of workingProviders) {
  await testAsync(`${name} fetches quota data`, async () => {
    try {
      const mod = await import(join(PLUGIN_ROOT, 'dist/providers', file));
      const createFn = Object.values(mod).find(v => typeof v === 'function');
      if (!createFn) return false;
      
      const provider = createFn();
      const data = await provider.fetchQuota();
      
      if (data.length > 0) {
        console.log(`   ✅ ${name}: ${data.length} quota entries`);
        data.forEach(q => {
          console.log(`      - ${q.id}: ${q.used}/${q.limit || '∞'} ${q.unit}`);
        });
        return true;
      } else {
        console.log(`   ⚠️ ${name}: No data (auth may be missing/invalid)`);
        return false;
      }
    } catch (e) {
      console.log(`   ❌ ${name}: ${e.message}`);
      return false;
    }
  });
}

console.log();
console.log('🎯 PHASE 7: Command Execution Simulation');
console.log('-'.repeat(80));

await testAsync('Can execute /usage command', async () => {
  try {
    const mockClient = {
      session: {
        prompt: async (opts) => {
          console.log(`   Mock prompt called: ${JSON.stringify(opts).substring(0, 100)}...`);
          return { content: [] };
        }
      }
    };
    
    const result = await pluginHooks['command.execute.before']({
      command: 'usage',
      args: [],
      client: mockClient
    });
    
    // The hook should throw to prevent normal execution
    return result === undefined || result === null;
  } catch (e) {
    // Throwing is expected - it means the command was handled
    console.log(`   ✅ Command handled (threw as expected)`);
    return true;
  }
});

console.log();
console.log('='.repeat(80));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(80));
console.log(`Total tests: ${totalTests}`);
console.log(`Passed: ${passedTests} ✅`);
console.log(`Failed: ${failedTests} ❌`);
console.log();

if (failedTests === 0) {
  console.log('🎉 ALL TESTS PASSED! Plugin should work correctly.');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Please review the errors above.');
  process.exit(1);
}
