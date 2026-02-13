# MiniMax

## Auth
- Preferred: `opencode auth login minimax`.
- Fallback env: `MINIMAX_API_KEY`.

## Quota Query Strategy
- Tries these in order (unless overridden by `MINIMAX_REMAINS_URL`):
  - `https://api.minimax.io/v1/coding_plan/remains`
  - `https://api.minimax.io/v1/api/openplatform/coding_plan/remains`
  - `https://api.minimaxi.com/v1/coding_plan/remains`
  - `https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains`
  - `https://platform.minimax.io/v1/coding_plan/remains`
  - `https://platform.minimax.io/v1/api/openplatform/coding_plan/remains`

## Telemetry Confidence
- `authoritative` when `model_remains` is returned.

## Notes
- `insufficient balance` indicates billing/credits issue, not token parsing failure.
- CodexBar also uses web-cookie fallbacks for MiniMax web UI routes; this plugin currently uses API-key flow.
