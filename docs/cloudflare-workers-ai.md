# Cloudflare Workers AI

## Auth
- Preferred: `opencode auth login cloudflare-workers-ai`.
- Requires API token; account ID improves diagnostics (`CLOUDFLARE_ACCOUNT_ID`).

## Quota Query Strategy
- Connectivity check against Cloudflare account AI endpoints.
- If account ID missing, plugin attempts account discovery (single-account token only).

## Telemetry Confidence
- `status-only`.

## Notes
- Usage/remaining is primarily dashboard-driven for many plans.
