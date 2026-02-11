#!/usr/bin/env bash
# Test Codex (ChatGPT) /wham/usage endpoint
# Returns: plan_type, rate_limit.primary_window (5h burst), secondary_window (7d rolling), credits

set -euo pipefail

AUTH_FILE="$HOME/.local/share/opencode/auth.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "ERROR: auth.json not found at $AUTH_FILE"
  exit 1
fi

ACCESS=$(python3 -c "import json; d=json.load(open('$AUTH_FILE')); print(d['openai']['access'])")

echo "=== Codex (ChatGPT) /wham/usage ==="
echo ""
curl -s "https://chatgpt.com/backend-api/wham/usage" \
  -H "Authorization: Bearer $ACCESS" \
  | python3 -m json.tool
