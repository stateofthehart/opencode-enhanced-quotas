# OpenRouter

## Auth
- Preferred: `opencode auth login openrouter`.
- Fallback: `OPENROUTER_API_KEY` or `~/.config/opencode/openrouter-auth.json`.

## Quota Query Strategy
- Official key endpoint: `GET https://openrouter.ai/api/v1/key`.
- Parses `limit`, `limit_remaining`, and `usage` when exposed.

## Telemetry Confidence
- `authoritative`.

## Notes
- `usage=0` is valid and often means no billable calls yet.
