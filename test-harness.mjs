#!/usr/bin/env node
/**
 * Local test harness for opencode-enhanced-quotas plugin
 * This simulates what OpenCode does when loading and running the plugin
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = join(__dirname, 'dist', 'index.js');

console.log('🔧 OpenCode Plugin Test Harness');
console.log('================================\n');
console.log('Plugin path:', PLUGIN_PATH);
console.log('');

// Mock OpenCode client
const mockClient = {
  session: {
    prompt: async ({ path, body }) => {
      console.log('\n📤 Plugin sent response:');
      console.log('   Path:', path);
      console.log('   Body:', JSON.stringify(body, null, 2).substring(0, 500));
      return { ok: true };
    }
  }
};

// Test 1: Load the plugin
console.log('Test 1: Loading plugin...');
try {
  const pluginModule = await import(PLUGIN_PATH);
  console.log('✅ Plugin loaded successfully');
  console.log('   Exports:', Object.keys(pluginModule));
  
  const pluginFn = pluginModule.default;
  console.log('\n   Plugin type:', typeof pluginFn);
  console.log('   Plugin name:', pluginFn?.name);
  
  // Call the plugin function to get hooks (this is what OpenCode does)
  console.log('\n   Calling plugin function to initialize...');
  const plugin = await pluginFn({
    client: mockClient,
    $: {}, // OpenCode's $ helper (not used in quota plugin)
    directory: '/home/ethan/.config/opencode', // Config directory
    serverUrl: 'http://localhost:0', // Mock server URL
  });
  console.log('   Plugin initialized');
  console.log('   Plugin return value:', typeof plugin);
  console.log('   Plugin keys:', Object.keys(plugin || {}));
  console.log('   Hooks available:', Object.keys(plugin.hooks || plugin || {}));
  
  // Test 2: Call config hook
  console.log('\n\nTest 2: Calling config hook...');
  if (plugin?.hooks?.config) {
    const mockConfig = { command: {} };
    await plugin.hooks.config(mockConfig);
    console.log('✅ Config hook executed');
    console.log('   Registered commands:', Object.keys(mockConfig.command));
  } else {
    console.log('❌ No config hook found');
  }
  
  // Test 3: Call command.execute.before hook
  console.log('\n\nTest 3: Testing /usage command...');
  const commandHook = plugin?.['command.execute.before'];
  if (commandHook) {
    console.log('✅ Command hook found');
    const mockInput = {
      command: '/usage',
      args: [],
      text: '/usage'
    };
    
    try {
      await commandHook(mockInput, mockClient);
      console.log('✅ Command hook executed (no error)');
    } catch (e) {
      if (e.message?.includes('ABORT_COMMAND_EXECUTION') || e.message?.includes('Deterministic command')) {
        console.log('✅ Command executed and aborted properly (expected behavior)');
      } else {
        console.log('❌ Command failed with error:', e.message);
        console.log(e.stack);
      }
    }
  } else {
    console.log('❌ No command.execute.before hook found');
    console.log('   Available keys:', Object.keys(plugin || {}));
  }
  
  // Test 4: Direct provider test
  console.log('\n\nTest 4: Testing providers directly...');
  const providersDir = join(__dirname, 'dist', 'providers');
  const providerFiles = ['codex.js', 'anthropic.js', 'copilot.js', 'cursor.js', 'gemini.js', 'zai.js', 'minimax.js'];
  
  for (const file of providerFiles) {
    try {
      const mod = await import(join(providersDir, file));
      const createFn = Object.values(mod).find(v => typeof v === 'function');
      if (createFn) {
        const provider = createFn();
        console.log(`\n  📦 ${provider.id}:`);
        const quotas = await provider.fetchQuota();
        if (quotas.length > 0) {
          quotas.forEach(q => {
            const pct = q.limit ? Math.round((q.used / q.limit) * 100) : 'N/A';
            console.log(`     ✅ ${q.id}: ${q.used}/${q.limit ?? '∞'} (${pct}%)`);
          });
        } else {
          console.log(`     ⚠️  No data (auth may be missing)`);
        }
      }
    } catch (e) {
      console.log(`  ❌ ${file}: ${e.message.substring(0, 80)}`);
    }
  }
  
} catch (e) {
  console.error('❌ Failed to load plugin:', e.message);
  console.error(e.stack);
  process.exit(1);
}

console.log('\n\n✅ Test harness completed');
