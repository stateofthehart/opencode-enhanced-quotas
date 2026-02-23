#!/bin/bash
# Run the OpenCode Quotas Gateway as a background service

# Load API keys
if [ -f ~/.config/opencode/provider-keys.env ]; then
    source ~/.config/opencode/provider-keys.env
fi

# Run gateway
cd "$(dirname "$0")"
exec node dist/cli.js serve --port 3333
