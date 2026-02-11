#!/usr/bin/env bash
# Test Anthropic rate limit headers via minimal /v1/messages call
# Rate limits are ONLY in response headers, not the body
# Cost: ~$0.00001 per call (1 output token on cheapest model)

set -euo pipefail

AUTH_FILE="$HOME/.local/share/opencode/auth.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "ERROR: auth.json not found at $AUTH_FILE"
  exit 1
fi

ACCESS=$(python3 -c "import json; d=json.load(open('$AUTH_FILE')); print(d['anthropic']['access'])")

echo "=== Anthropic /v1/messages (x-api-key auth) ==="
echo "--- Response Headers + Body ---"
echo ""
curl -sD - "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ACCESS" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-haiku-20241022","max_tokens":1,"messages":[{"role":"user","content":"x"}]}'

echo ""
echo ""
echo "=== If the above returned 401, trying Bearer auth instead ==="
echo "--- Response Headers + Body ---"
echo ""
curl -sD - "https://api.anthropic.com/v1/messages" \
  -H "Authorization: Bearer $ACCESS" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-haiku-20241022","max_tokens":1,"messages":[{"role":"user","content":"x"}]}'
