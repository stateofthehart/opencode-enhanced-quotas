# Codex

## Auth
- Managed by OpenCode OAuth (`opencode auth login openai` / `opencode auth login`).

## Quota Query Strategy
- Uses OpenCode backend usage endpoint (`/wham/usage` or `/api/codex/usage` depending on base URL).
- Parses `primary_window`, `secondary_window`, and optional `credits` limits.

## Telemetry Confidence
- `authoritative`.
