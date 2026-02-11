#!/usr/bin/env node
/**
 * Diagnostic script to debug plugin loading in OpenCode context
 * Run this from within OpenCode or terminal to see exactly what's happening
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = __dirname;
const DEBUG_LOG = join(PLUGIN_ROOT, 'debug-load.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    writeFileSync(DEBUG_LOG, line + '\n', { flag: 'a' });
  } catch {}
}

log('=== PLUGIN LOAD DIAGNOSTIC ===');
log(`Plugin root: ${PLUGIN_ROOT}`);

// Test 1: Can we import the module?
log('\n--- TEST 1: Module Import ---');
try {
  const mod = await import(join(PLUGIN_ROOT, 'dist/index.js'));
  log(`✅ Module imported successfully`);
  log(`   Default export type: ${typeof mod.default}`);
  log(`   Export keys: ${Object.keys(mod).join(', ')}`);
} catch (e) {
  log(`❌ Import failed: ${e.message}`);
  log(`   Stack: ${e.stack}`);
  process.exit(1);
}

// Test 2: Can we call the plugin function?
log('\n--- TEST 2: Plugin Function Execution ---');
try {
  const mod = await import(join(PLUGIN_ROOT, 'dist/index.js'));
  const pluginFn = mod.default;
  
  // Create minimal mock client
  const mockClient = {
    session: {
      prompt: async (opts) => {
        log(`   Mock prompt called with: ${JSON.stringify(opts).substring(0, 100)}`);
        return { content: [{ type: 'text', text: 'mock response' }] };
      }
    }
  };
  
  log(`   Calling plugin with workspace=${process.cwd()}, directory=${PLUGIN_ROOT}`);
  const hooks = await pluginFn({
    workspace: process.cwd(),
    directory: PLUGIN_ROOT,
    client: mockClient
  });
  
  log(`✅ Plugin function executed successfully`);
  log(`   Returned hooks: ${Object.keys(hooks || {}).join(', ')}`);
  
  // Check each hook
  if (hooks.config) log(`   ✅ config hook present`);
  else log(`   ❌ config hook missing`);
  
  if (hooks['command.execute.before']) log(`   ✅ command.execute.before hook present`);
  else log(`   ❌ command.execute.before hook missing`);
  
  if (hooks['experimental.text.complete']) log(`   ✅ experimental.text.complete hook present`);
  else log(`   ❌ experimental.text.complete hook missing`);
  
  // Test 3: Execute config hook
  log('\n--- TEST 3: Config Hook Execution ---');
  if (hooks.config) {
    try {
      const config = { command: {} };
      await hooks.config(config);
      const commands = Object.keys(config.command);
      log(`✅ Config hook executed successfully`);
      log(`   Registered commands: ${commands.join(', ')}`);
      
      if (commands.includes('usage')) log(`   ✅ /usage command registered`);
      else log(`   ❌ /usage command NOT registered`);
      
      if (commands.includes('mymodels')) log(`   ✅ /mymodels command registered`);
      else log(`   ❌ /mymodels command NOT registered`);
    } catch (e) {
      log(`❌ Config hook failed: ${e.message}`);
      log(`   Stack: ${e.stack}`);
    }
  }
  
  // Test 4: Test command execution (if commands registered)
  log('\n--- TEST 4: Command Hook Execution ---');
  if (hooks['command.execute.before']) {
    try {
      let promptCalled = false;
      const testClient = {
        session: {
          prompt: async (opts) => {
            promptCalled = true;
            log(`   Prompt called with path.id: ${opts?.path?.id}`);
            log(`   Prompt body.noReply: ${opts?.body?.noReply}`);
            log(`   Prompt parts count: ${opts?.body?.parts?.length}`);
            return { content: [] };
          }
        }
      };
      
      try {
        await hooks['command.execute.before']({
          command: 'usage',
          args: [],
          client: testClient
        });
        log(`⚠️ Command hook returned normally (expected to throw)`);
      } catch (e) {
        if (e.message && e.message.includes('QUOTA_COMMAND_HANDLED')) {
          log(`✅ Command hook executed and threw expected error`);
          log(`   Prompt was called: ${promptCalled}`);
        } else {
          log(`❌ Command hook threw unexpected error: ${e.message}`);
        }
      }
    } catch (e) {
      log(`❌ Command hook test failed: ${e.message}`);
    }
  }
  
} catch (e) {
  log(`❌ Plugin execution failed: ${e.message}`);
  log(`   Stack: ${e.stack}`);
}

// Test 5: Check auth files
log('\n--- TEST 5: Auth File Check ---');
const authFiles = {
  'OpenCode auth': join(homedir(), '.local/share/opencode/auth.json'),
  'Claude creds': join(homedir(), '.claude/.credentials.json'),
  'Cursor auth': join(homedir(), '.config/cursor/auth.json'),
  'Gemini OAuth': join(homedir(), '.gemini/oauth_creds.json'),
};

for (const [name, path] of Object.entries(authFiles)) {
  const exists = existsSync(path);
  log(`   ${exists ? '✅' : '❌'} ${name}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
}

// Test 6: Provider quick tests
log('\n--- TEST 6: Provider Quick Tests ---');
const providers = [
  { name: 'Codex', file: 'codex.js' },
  { name: 'Copilot', file: 'copilot.js' },
  { name: 'Claude', file: 'anthropic.js' },
];

for (const { name, file } of providers) {
  try {
    const mod = await import(join(PLUGIN_ROOT, 'dist/providers', file));
    const createFn = Object.values(mod).find(v => typeof v === 'function');
    if (!createFn) {
      log(`   ❌ ${name}: No factory function`);
      continue;
    }
    const provider = createFn();
    const data = await provider.fetchQuota();
    log(`   ${data.length > 0 ? '✅' : '⚠️'} ${name}: ${data.length} entries`);
  } catch (e) {
    log(`   ❌ ${name}: ${e.message.substring(0, 50)}`);
  }
}

log('\n=== DIAGNOSTIC COMPLETE ===');
log(`Debug log written to: ${DEBUG_LOG}`);
console.log(`\n📄 Full debug log: ${DEBUG_LOG}`);
