# OpenCode Enhanced Quotas

`@ereinha/opencode-enhanced-quotas` is an OpenCode plugin + CLI that aggregates quota and rate-limit usage from multiple AI providers in one table.

It supports:
- in-chat footer display
- `/usage`, `/mymodels`, `/usage-logs` commands
- standalone terminal usage via `opencode-quotas`

## What It Tracks

Current providers:
- Antigravity
- Codex (ChatGPT)
- GitHub Copilot
- Claude
- Cursor
- Gemini
- z.ai
- MiniMax
- JetBrains AI (optional/local)

Provider failures are isolated, so one failing provider does not break the full table.

## Install

### Local plugin (recommended for active development)

```bash
git clone https://github.com/ereinha/opencode-enhanced-quotas ~/.opencode/plugins/opencode-enhanced-quotas
cd ~/.opencode/plugins/opencode-enhanced-quotas
npm install
npm run build
```

If your OpenCode setup auto-loads plugins from `~/.opencode/plugins`, nothing else is required.

### NPM plugin

If using npm plugin registration in OpenCode config:

```json
{
  "plugin": [
    "@ereinha/opencode-enhanced-quotas"
  ]
}
```

## Commands

Inside OpenCode:
- `/usage` - show full quota table
- `/mymodels` - show model-filtered quota view
- `/usage-logs` - show recent plugin debug logs from `~/.local/share/opencode/quotas-debug.log`

Terminal:
- `opencode-quotas` - show quota table
- `opencode-quotas --provider <id> --model <id>` - filtered output
- `opencode-quotas help` - CLI help

## Provider Authentication Patterns

### Codex
- Source: `~/.local/share/opencode/auth.json`
- Method: OAuth bearer from OpenCode auth store
- Notes: Works automatically if OpenCode auth is valid.

### Copilot
- Source: `~/.local/share/opencode/auth.json` (`github-copilot`)
- Method: OAuth bearer token to GitHub internal Copilot endpoint
- Notes: Works automatically if Copilot is logged in via OpenCode.

### Claude
- Source: `~/.claude/.credentials.json`
- Method: OAuth bearer token to Anthropic OAuth usage endpoint
- Notes: If expired, run `claude auth login`.

### Gemini
- Source: `~/.gemini/oauth_creds.json`
- Method: OAuth access token + refresh token flow
- Implementation follows CodexBar pattern:
  - detects expired access token
  - refreshes via `https://oauth2.googleapis.com/token`
  - updates local creds file
- OAuth client credential resolution order:
  1. dynamic discovery from installed Gemini CLI internals
  2. `process.env` fallback (`GEMINI_OAUTH_CLIENT_ID` + `GEMINI_OAUTH_CLIENT_SECRET`)
- Notes: If creds are missing, authenticate through Gemini CLI/TUI first.

Environment fallback example:

```bash
export GEMINI_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
export GEMINI_OAUTH_CLIENT_SECRET="..."
```

### Cursor
- Primary method (CodexBar-aligned): web session cookies for `cursor.com`
- Recommended source: manual cookie header in `~/.config/opencode/cursor-auth.json`

```json
{
  "cookie": "WorkosCursorSessionToken=...; __Secure-next-auth.session-token=...; ..."
}
```

- Notes:
  - `cursor-agent login` alone is often not enough for usage endpoints.
  - Usage endpoint expects browser session cookie context.
  - On Linux/headless, cookie decryption can fail without keyring tooling; manual cookie mode is most reliable.

### z.ai
- Source: `Z_AI_API_KEY` env or `~/.config/opencode/zai-config.json`
- Notes: Some plans/free tiers may return limited or no quota detail.

### MiniMax
- Source: `MINIMAX_API_KEY` env or `~/.config/opencode/minimax-config.json`
- Notes: Requires coding-plan compatible key for quota endpoint.

### JetBrains AI
- Source: local JetBrains XML usage files
- Notes: Optional. Useful only if you use JetBrains AI Assistant.

## Headless vs Standard Setup

### Standard desktop setup
- Log into provider web/CLI apps normally.
- Plugin reads local credential stores automatically.

### Headless/server setup
- Prefer manual config inputs where possible:
  - Cursor: manual cookie file (`cursor-auth.json`)
  - z.ai / MiniMax: API key config files
- Keep provider CLI credentials fresh (Gemini/Claude).

### Standard environment file convention

This project reads runtime secrets from `process.env`. If you prefer a central file, keep one at:

- `~/.config/opencode/.env`

Then load it before launching OpenCode or running `opencode-quotas`, for example:

```bash
set -a
source ~/.config/opencode/.env
set +a
opencode-quotas
```

Common environment keys:
- `GEMINI_OAUTH_CLIENT_ID`
- `GEMINI_OAUTH_CLIENT_SECRET`
- `Z_AI_API_KEY`
- `MINIMAX_API_KEY`
- `CURSOR_COOKIE`

## Linux Dependencies (for browser cookie/keyring path)

For Ubuntu:

```bash
sudo apt update
sudo apt install -y libsecret-1-0 libsecret-tools gnome-keyring dbus-user-session sqlite3
```

These are needed if you want automatic encrypted browser cookie handling. If that is unreliable, use manual Cursor cookie mode.

## OS Support

- Linux: fully supported (recommended path for Cursor is manual cookie)
- macOS: supported
- Windows: best-effort for local auth files; cookie tooling may differ by browser and environment

## Logging and TUI Safety

Plugin runtime logs now go to file and avoid noisy stdout/stderr in OpenCode TUI.

Debug log file:
- `~/.local/share/opencode/quotas-debug.log`

OpenCode command to inspect logs safely:
- `/usage-logs`

Enable verbose debug logging:

```bash
export OPENCODE_QUOTAS_DEBUG=1
```

## Troubleshooting

### `/usage` missing
- Ensure plugin is loaded in OpenCode status/plugins list.
- Rebuild local plugin:

```bash
cd ~/.opencode/plugins/opencode-enhanced-quotas
npm run build
```

### Provider missing from table
- Run `opencode-quotas` in terminal first.
- Confirm auth file/token exists.
- For Cursor, validate cookie manually with:

```bash
COOKIE="$(jq -r '.cookie' ~/.config/opencode/cursor-auth.json)"
curl -sS "https://cursor.com/api/usage-summary" -H "Accept: application/json" -H "Cookie: $COOKIE" | jq .
```

### Claude weekly shows `ERR` at 100%
- This is expected behavior: you are at limit.

## Security Notes

- Secrets stay local.
- Plugin only calls provider APIs required for quota retrieval.
- Do not paste live cookies/tokens in logs or shared chats.

## License

MIT
