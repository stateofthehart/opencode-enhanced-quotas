# Together

## Auth
- Preferred: `opencode auth login together` when supported by your OpenCode build.
- Fallback: `opencode-quotas auth setup together` or `TOGETHER_API_KEY` env.

## Quota Query Strategy
- Base endpoint: `GET https://api.together.xyz/v1/models`.
- Header extraction: `x-ratelimit-*` when present.
- Probe fallback: one-word request to `POST /v1/chat/completions` to force rate-limit headers.

## Telemetry Confidence
- `header-based`.

## Notes
- Header availability depends on model/route and account tier.
