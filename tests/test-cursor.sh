#!/usr/bin/env bash
# Test Cursor Stripe profile endpoint
# Cursor has NO official individual usage API — this is the best available
# Requires Cursor to be installed (reads token from its SQLite DB)

set -euo pipefail

VSCDB="$HOME/.config/Cursor/User/globalStorage/state.vscdb"

# macOS fallback
if [[ ! -f "$VSCDB" ]]; then
  VSCDB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
fi

if [[ ! -f "$VSCDB" ]]; then
  echo "ERROR: Cursor state.vscdb not found"
  echo "  Linux:  ~/.config/Cursor/User/globalStorage/state.vscdb"
  echo "  macOS:  ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
  exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
  echo "ERROR: sqlite3 is required but not installed"
  exit 1
fi

TOKEN=$(sqlite3 "$VSCDB" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'" 2>/dev/null)

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Could not extract Cursor access token from state.vscdb"
  exit 1
fi

echo "=== Cursor Stripe Profile ==="
echo ""
curl -s "https://www.cursor.com/api/auth/full_stripe_profile" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
