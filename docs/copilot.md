# GitHub Copilot

## Auth
- Managed by OpenCode OAuth: `opencode auth login github-copilot`.

## Quota Query Strategy
- Calls `https://api.github.com/copilot_internal/user` with Copilot token.
- Tracks premium interactions and chat/completions entitlement states.

## Telemetry Confidence
- `authoritative`.
