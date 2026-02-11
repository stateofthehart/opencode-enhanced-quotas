#!/usr/bin/env bash
# Test Google Gemini API — list models to check auth works
# No dedicated rate-limit endpoint; limits come as 429 responses
# Google OAuth tokens are short-lived (~1hr) — may 401 if expired

set -euo pipefail

AUTH_FILE="$HOME/.local/share/opencode/auth.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "ERROR: auth.json not found at $AUTH_FILE"
  exit 1
fi

ACCESS=$(python3 -c "import json; d=json.load(open('$AUTH_FILE')); print(d['google']['access'])")

echo "=== Google Gemini API — List Models ==="
echo ""
curl -s "https://generativelanguage.googleapis.com/v1beta/models" \
  -H "Authorization: Bearer $ACCESS" \
  | python3 -m json.tool
