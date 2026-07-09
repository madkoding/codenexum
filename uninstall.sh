#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SKILL_DIR="$OPENCODE_DIR/skills/context-manager"
CONFIG="$OPENCODE_DIR/opencode.jsonc"
PLUGIN_FILE="$PLUGIN_DIR/@madkoding-context-manager.ts"
PLUGIN_NAME="madkoding-context-manager"

echo "Uninstalling context-manager..."

# ── Remove plugin file ──
if [ -f "$PLUGIN_FILE" ]; then
  rm -f "$PLUGIN_FILE"
  echo "  ✓ Removed $PLUGIN_FILE"
fi

# ── Remove skill ──
if [ -d "$SKILL_DIR" ]; then
  rm -rf "$SKILL_DIR"
  echo "  ✓ Removed $SKILL_DIR"
fi

# ── Remove from config (robust, via bun) ──
if [ -f "$CONFIG" ]; then
  bun -e '
    const fs = require("fs");
    const path = "'"$CONFIG"'";
    const name = "'"$PLUGIN_NAME"'";
    let txt = fs.readFileSync(path, "utf8");
    if (!txt.includes(name)) { process.exit(0); }
    let obj = {};
    try { obj = JSON.parse(txt); }
    catch (e) {
      const stripped = txt
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      obj = JSON.parse(stripped);
    }
    if (Array.isArray(obj.plugin)) {
      obj.plugin = obj.plugin.filter((p) => !p.includes(name));
    }
    fs.writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
    console.log("  ✓ Removed from " + path);
  '
fi

echo
echo "  Done. Restart opencode for changes to take effect."