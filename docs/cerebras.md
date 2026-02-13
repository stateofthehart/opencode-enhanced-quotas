# Cerebras

## Auth
- Preferred: `opencode auth login cerebras`.
- Fallback env: `CEREBRAS_API_KEY`.

## Quota Query Strategy
- Uses `GET https://api.cerebras.ai/v1/models` for connectivity.
- Pulls `x-ratelimit-*` headers when available.

## Telemetry Confidence
- `header-based`.

## Notes
- Shared tiers may omit explicit quota fields; probe mode can still surface headers.
