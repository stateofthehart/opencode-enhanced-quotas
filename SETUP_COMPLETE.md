# Enhanced Quotas Plugin - Setup Complete ✅

## Problem Fixed
Bun was failing to install the plugin because it was being treated as an npm package instead of a local plugin.

## Solution Applied
Ran `bun link` in the plugin directory to register it as a local linked package:

```bash
cd ~/.opencode/plugins/opencode-enhanced-quotas
bun link
```

## Current Status
- ✅ Plugin builds successfully
- ✅ Plugin is linked locally
- ✅ OpenCode loads without errors (v1.1.53)
- ✅ `/usage` command implemented
- ✅ `/mymodels` command implemented

## How to Use

### /usage Command
Shows comprehensive quota usage information:
```
/usage                    # Show all quotas in table format
/usage format=json        # JSON output
/usage format=compact     # Compact text output
/usage provider=claude    # Filter by provider
```

### /mymodels Command
Shows available models filtered by quota status:
```
/mymodels                    # Show all models by status
/mymodels status=available   # Only available models (<80% usage)
/mymodels status=limited     # Rate-limited models (80-100% usage)
/mymodels status=exhausted   # Exhausted models (100%+ usage)
/mymodels provider=cursor    # Filter by provider
```

## Files Modified
- `~/.opencode/plugins/opencode-enhanced-quotas/package.json` - Fixed name field
- `~/.opencode/plugins/opencode-enhanced-quotas/src/index.ts` - Added tool definitions
- `~/.opencode/plugins/opencode-enhanced-quotas/dist/index.js` - Built successfully

## If Issues Persist
If you still see errors, try:
1. Restart OpenCode completely
2. Run `bun install` in the plugin directory
3. Rebuild with `bun run build`

The plugin should now work correctly!
