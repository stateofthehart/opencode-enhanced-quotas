# NVIDIA NIM

## Auth
- Preferred: `opencode auth login nvidia`.
- Fallback env: `NVIDIA_NIM_API_KEY` or `NGC_API_KEY`.

## Quota Query Strategy
- Connectivity/model probe via `GET https://integrate.api.nvidia.com/v1/models`.
- Rate-limit extraction from response headers when present.

## Telemetry Confidence
- `header-based`.

## Notes
- Hosted trial limits are often dashboard-centric; explicit remaining quota API may not be exposed.
