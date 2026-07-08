#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SKILL_DIR="$OPENCODE_DIR/skills/context-manager"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔═══════════════════════════════════════════════════════╗
║  context-manager — opencode plugin installer          ║
╚═══════════════════════════════════════════════════════╝"
echo
echo "  Target: $OPENCODE_DIR"
echo

# ── 1. Plugin file ──
mkdir -p "$PLUGIN_DIR"
cp "$REPO_DIR/plugins/@madkoding-context-manager.ts" "$PLUGIN_DIR/@madkoding-context-manager.ts"
echo "  ✓ Plugin → $PLUGIN_DIR/@madkoding-context-manager.ts"

# ── 2. Skill ──
mkdir -p "$SKILL_DIR"
cp "$REPO_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"
echo "  ✓ Skill  → $SKILL_DIR/SKILL.md"

# ── 3. Ensure @opencode-ai/plugin is installed ──
if [ ! -d "$OPENCODE_DIR/node_modules/@opencode-ai/plugin" ]; then
  echo
  echo "  ⚠ @opencode-ai/plugin not found, installing..."
  if [ ! -f "$OPENCODE_DIR/package.json" ]; then
    echo '{"dependencies":{"@opencode-ai/plugin":"latest"}}' > "$OPENCODE_DIR/package.json"
  fi
  if command -v bun >/dev/null 2>&1; then
    (cd "$OPENCODE_DIR" && bun install --silent)
    echo "  ✓ @opencode-ai/plugin installed"
  else
    echo "  ✗ bun not found — run: cd $OPENCODE_DIR && bun install"
    exit 1
  fi
fi

# ── 4. Add plugin to opencode.jsonc if missing ──
CONFIG="$OPENCODE_DIR/opencode.jsonc"
PLUGIN_ENTRY="$PLUGIN_DIR/@madkoding-context-manager.ts"

if [ -f "$CONFIG" ]; then
  if grep -q "madkoding-context-manager" "$CONFIG" 2>/dev/null; then
    echo "  ✓ Plugin already in config"
  else
    # Try to add to existing plugin array
    if grep -q '"plugin"' "$CONFIG" 2>/dev/null; then
      # Insert after the last entry in the plugin array
      sed -i "/\"plugin\"/,/]/ s|]|  \"$PLUGIN_ENTRY\"\n]|" "$CONFIG" 2>/dev/null || true
      if grep -q "madkoding-context-manager" "$CONFIG" 2>/dev/null; then
        echo "  ✓ Added to plugin array in $CONFIG"
      else
        echo
        echo "  ⚠ Could not auto-edit config. Add this to the \"plugin\" array in $CONFIG:"
        echo "    \"$PLUGIN_ENTRY\""
      fi
    else
      echo
      echo "  ⚠ No \"plugin\" key in config. Add this to $CONFIG:"
      echo "    \"plugin\": [\"$PLUGIN_ENTRY\"]"
    fi
  fi
else
  # Create minimal config
  cat > "$CONFIG" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_ENTRY"]
}
EOF
  echo "  ✓ Created $CONFIG"
fi

# ── Done ──
echo
echo "  ──────────────────────────────────────────────
  Done! Restart opencode to load the plugin.

  To uninstall: ./uninstall.sh
  ──────────────────────────────────────────────"