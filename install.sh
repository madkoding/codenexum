#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_NAME="@madtech/opencode-context-manager-plugin"
CONFIG="$OPENCODE_DIR/opencode.jsonc"

log() {
  printf '{"level":"%s","service":"context-manager.install","message":"%s"}\n' "$1" "$2" >&2
}

log info "building dashboard..."
(cd "$(dirname "$0")/dashboard" && bun install 2>/dev/null && bun run build)

log info "installing from local tarball..."
TARBALL=$(cd "$(dirname "$0")" && npm pack 2>/dev/null | tail -1)

mkdir -p "$OPENCODE_DIR/plugins"
cd "$OPENCODE_DIR/plugins"
npm init -y >/dev/null 2>&1 || true
npm install "$(dirname "$0")/$TARBALL" 2>/dev/null
rm -f "$TARBALL"

# Add to config
/opt/homebrew/bin/bun -e "
const fs = require('fs');
const path = '$CONFIG';
const plugin = '$PLUGIN_NAME';
let txt = fs.readFileSync(path, 'utf8');
let obj = JSON.parse(txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '\$1'));
if (!Array.isArray(obj.plugin)) obj.plugin = [];
obj.plugin = obj.plugin.filter((p: string) => !p.includes('context-manager'));
obj.plugin.unshift(plugin);
fs.copyFileSync(path, path + '.bak');
fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
console.log('added', plugin, 'to config');
" 2>&1

log info "done. restart opencode to activate."
