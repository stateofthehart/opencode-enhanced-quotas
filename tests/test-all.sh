#!/usr/bin/env bash
# Run all provider endpoint tests
# Usage: ./tests/test-all.sh
# Or run individual tests: ./tests/test-codex.sh

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

run_test() {
  local script="$1"
  local name="$2"
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  $name"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  if bash "$script"; then
    echo ""
    echo "  ✓ $name completed"
  else
    echo ""
    echo "  ✗ $name failed (exit $?)"
  fi
  echo ""
  echo ""
}

run_test "$DIR/test-codex.sh"     "Codex (ChatGPT)"
run_test "$DIR/test-github.sh"    "GitHub API"
run_test "$DIR/test-anthropic.sh" "Anthropic (Claude)"
run_test "$DIR/test-google.sh"    "Google (Gemini)"
run_test "$DIR/test-cursor.sh"    "Cursor"

echo "Done. Paste the output back so we can tailor the /usage display."
