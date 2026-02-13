# Cursor

## Auth
- Use `opencode-quotas login cursor` for browser-assisted cookie/session capture.
- Also supports `CURSOR_COOKIE` and `~/.config/opencode/cursor-auth.json`.

## Quota Query Strategy
- Primary endpoint: `https://cursor.com/api/usage-summary`.
- Optional profile endpoint for user id validation: `https://cursor.com/api/auth/me`.

## Telemetry Confidence
- `authoritative` for current Cursor account usage endpoint.
