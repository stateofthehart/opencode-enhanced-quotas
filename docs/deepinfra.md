# DeepInfra

## Auth
- Preferred: `opencode auth login deepinfra` when supported by your OpenCode build.
- Fallback: `opencode-quotas auth setup deepinfra` or `DEEPINFRA_API_KEY` env.

## Quota Query Strategy
- Base endpoint: `GET https://api.deepinfra.com/v1/openai/models`.
- Header extraction: `x-ratelimit-*` when present.
- Probe fallback: one-word request to `POST /v1/openai/chat/completions`.

## Telemetry Confidence
- `header-based`.

## Notes
- Some routes return no quota headers; doctor/probe mode helps verify real-time header availability.
