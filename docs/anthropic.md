# Claude (Anthropic)

## Auth
- Managed by OpenCode/Claude OAuth.
- Ensure `opencode auth login anthropic` and local Claude credentials are present.

## Quota Query Strategy
- Calls `https://api.anthropic.com/api/oauth/usage`.
- Parses five-hour and seven-day windows plus plan-specific usage buckets.

## Telemetry Confidence
- `authoritative`.
