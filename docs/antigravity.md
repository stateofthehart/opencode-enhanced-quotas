# Antigravity

## Auth
- Primary flow: `opencode auth login` (Google OAuth managed by OpenCode).
- Runtime credentials: `~/.config/opencode/antigravity-accounts.json` (fallback `~/.opencode/antigravity-accounts.json`).

## Quota Query Strategy
- Uses Google Cloud Code internal APIs via Antigravity auth token refresh.
- Primary fetch path in plugin: `fetchAvailableModels` -> parse `quotaInfo.remainingFraction` and `resetTime`.

## Telemetry Confidence
- `authoritative` for this plugin path, but depends on internal Google API behavior.

## Notes
- If doctor reports `invalid_grant`, refresh with `opencode auth login`.
- Antigravity and Gemini can coexist with separate local auth stores.
