# Groq

## Auth
- Preferred: `opencode auth login groq`.
- Fallback env: `GROQ_API_KEY`.

## Quota Query Strategy
- Base check: `GET https://api.groq.com/openai/v1/models`.
- Uses `x-ratelimit-*` and `retry-after` headers when available.
- Probe mode can force header visibility with low-token chat call.

## Telemetry Confidence
- `header-based`.
