#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SKILL_DIR="$OPENCODE_DIR/skills/context-manager"
CONFIG="$OPENCODE_DIR/opencode.jsonc"
PLUGIN_FILE="$PLUGIN_DIR/@madkoding-context-manager.ts"

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

# ── Remove from config (best effort) ──
if [ -f "$CONFIG" ] && grep -q "madkoding-context-manager" "$CONFIG" 2>/dev/null; then
  sed -i "/madkoding-context-manager/d" "$CONFIG" 2>/dev/null || true
  echo "  ✓ Removed from $CONFIG"
fi

echo
echo "  Done. Restart opencode for changes to take effect."