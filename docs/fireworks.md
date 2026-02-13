# Fireworks AI

## Auth
- Preferred: `opencode auth login fireworks-ai`.
- Fallback env: `FIREWORKS_API_KEY`.

## Quota Query Strategy
- Connectivity path: `GET https://api.fireworks.ai/inference/v1/models`.
- Reads `x-ratelimit-*` headers when returned.

## Telemetry Confidence
- `header-based`.

## Notes
- Header availability is route/model dependent; one-word probe can improve detection.
