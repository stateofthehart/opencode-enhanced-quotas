# Hugging Face

## Auth
- Preferred: `opencode auth login huggingface`.
- Fallback env: `HF_TOKEN` or `HUGGINGFACE_API_KEY`.

## Quota Query Strategy
- Connectivity/profile endpoint: `GET https://huggingface.co/api/whoami-v2`.
- Parses IETF `RateLimit` / `RateLimit-Policy` headers and `x-ratelimit-*` when available.

## Telemetry Confidence
- `header-based`.

## Notes
- Header availability can vary by route/tier; dashboard remains source of truth for billing.
