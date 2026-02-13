# Gemini

## Auth
- Runtime auth is Gemini CLI OAuth (`gemini auth login`), stored in `~/.gemini/oauth_creds.json`.

## Quota Query Strategy
- Uses Google internal endpoint: `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`.
- Optional project discovery via Cloud Resource Manager when needed.

## Telemetry Confidence
- `authoritative` for current Gemini CLI + internal quota path.

## Notes
- This is separate from Antigravity auth storage; both can coexist.
