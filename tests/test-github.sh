#!/usr/bin/env bash
# Test GitHub API /rate_limit endpoint
# Returns: resources.core, .search, .graphql, etc. — each with limit/used/remaining/reset

set -euo pipefail

AUTH_FILE="$HOME/.local/share/opencode/auth.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "ERROR: auth.json not found at $AUTH_FILE"
  exit 1
fi

ACCESS=$(python3 -c "import json; d=json.load(open('$AUTH_FILE')); print(d['github-copilot']['access'])")

echo "=== GitHub API /rate_limit ==="
echo ""
curl -s "https://api.github.com/rate_limit" \
  -H "Authorization: Bearer $ACCESS" \
  -H "Accept: application/vnd.github+json" \
  | python3 -m json.tool
