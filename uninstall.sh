#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_NAME="@madtech/opencode-context-manager-plugin"
CONFIG="$OPENCODE_DIR/opencode.jsonc"

log() {
  printf '{"level":"%s","service":"context-manager.uninstall","message":"%s"}\n' "$1" "$2" >&2
}

log info "removing plugin files..."
rm -rf "$OPENCODE_DIR/plugins/@madtech" "$OPENCODE_DIR/plugins/src" "$OPENCODE_DIR/plugins/dashboard" "$OPENCODE_DIR/skills/context-manager"

log info "removing from config..."
/opt/homebrew/bin/bun -e "
const fs = require('fs');
const path = '$CONFIG';
const plugin = '$PLUGIN_NAME';
let txt = fs.readFileSync(path, 'utf8');
let obj = JSON.parse(txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '\$1'));
if (Array.isArray(obj.plugin)) {
  obj.plugin = obj.plugin.filter((p: string) => !p.includes(plugin));
  fs.copyFileSync(path, path + '.bak');
  fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log('removed', plugin, 'from config');
}
" 2>&1

log info "done."
