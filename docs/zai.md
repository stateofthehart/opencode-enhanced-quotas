# z.ai

## Auth
- Preferred: `opencode auth login zai`.
- Fallback env: `Z_AI_API_KEY`.

## Quota Query Strategy
- Primary endpoint: `GET https://api.z.ai/api/monitor/usage/quota/limit`.
- Fallback endpoint: `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`.

## Telemetry Confidence
- `authoritative` when endpoint returns `data.limits`.

## Notes
- Some accounts return success without explicit limits; plugin reports connected status in that case.
- Additional de-facto endpoints from OSS trackers include model/tool usage slices under `/api/monitor/usage/*`.
