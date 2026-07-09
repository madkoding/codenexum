#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SKILL_DIR="$OPENCODE_DIR/skills/context-manager"
CONFIG="$OPENCODE_DIR/opencode.jsonc"
PLUGIN_REL="./plugins/@madkoding-context-manager.ts"
PLUGIN_NAME="madkoding-context-manager"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔═══════════════════════════════════════════════════════╗"
echo "║  context-manager — opencode plugin installer          ║"
echo "╚═══════════════════════════════════════════════════════╝"
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

# ── 4. Add plugin to opencode config ──
# Use bun to edit JSON robustly (handles comments in jsonc, commas, arrays).
add_plugin_to_config() {
  local cfg="$1" rel="$2" name="$3"
  bun -e '
    const fs = require("fs");
    const path = "'"$cfg"'";
    const rel = "'"$rel"'";
    const name = "'"$name"'";
    let txt = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : null;

    // Already present? (match by name substring)
    if (txt && txt.includes(name)) { console.log("  ✓ Plugin already in config"); process.exit(0); }

    // Build a JS object from the config if it exists, else start fresh.
    let obj = {};
    if (txt && txt.trim() !== "") {
      try { obj = JSON.parse(txt); }
      catch (e) {
        // jsonc with comments: strip // and /* */ then parse
        const stripped = txt
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        try { obj = JSON.parse(stripped); } catch (e2) {
          console.error("  ✗ Could not parse " + path + " as JSON/JSONC");
          process.exit(1);
        }
      }
    }

    if (!Array.isArray(obj.plugin)) obj.plugin = [];
    if (!obj.plugin.includes(rel)) obj.plugin.push(rel);

    // Preserve jsonc with $schema if creating fresh.
    if (!txt || txt.trim() === "") {
      obj["$schema"] = "https://opencode.ai/config.json";
    }

    const out = JSON.stringify(obj, null, 2) + "\n";
    fs.writeFileSync(path, out, "utf8");
    console.log("  ✓ Added to plugin array in " + path);
  '
}

if [ -f "$CONFIG" ]; then
  add_plugin_to_config "$CONFIG" "$PLUGIN_REL" "$PLUGIN_NAME"
else
  # Create minimal config
  cat > "$CONFIG" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_REL"]
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