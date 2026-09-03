#!/usr/bin/env bash
set -euo pipefail

plugin_source="/Users/devalparikh/Documents/Github/auto-eval/work/pstack-port"
plugin_parent="/Users/devalparikh/plugins"
plugin_target="/Users/devalparikh/plugins/pstack"
marketplace_file="/Users/devalparikh/.agents/plugins/marketplace.json"
creator_root="/Users/devalparikh/.codex/skills/.system/plugin-creator"

if [ -e "$plugin_target" ]; then
  echo "Refusing to overwrite existing target: $plugin_target" >&2
  exit 1
fi

if [ -e "$marketplace_file" ]; then
  echo "Refusing to replace an existing personal marketplace: $marketplace_file" >&2
  exit 1
fi

python3 "$creator_root/scripts/create_basic_plugin.py" pstack \
  --path "$plugin_parent" \
  --with-marketplace

rsync -a \
  --exclude node_modules \
  --exclude .bun-cache \
  "$plugin_source/" "$plugin_target/"

python3 "$creator_root/scripts/validate_plugin.py" "$plugin_target"

marketplace_name=$(python3 "$creator_root/scripts/read_marketplace_name.py" \
  --marketplace-path "$marketplace_file")

codex plugin add "pstack@$marketplace_name"

test ! -d "$plugin_target/skills/poteto-mode/scripts/node_modules"
test ! -d "$plugin_target/.bun-cache"
codex plugin list
