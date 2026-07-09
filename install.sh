#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SKILL_DIR="$OPENCODE_DIR/skills/context-manager"
CONFIG="$OPENCODE_DIR/opencode.jsonc"
PLUGIN_REL="./plugins/@madtech-opencode-context-manager-plugin.ts"
PLUGIN_NAME="@madtech/opencode-context-manager-plugin"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_PKG="$REPO_DIR/package.json"

log() {
  local level="$1" msg="$2"; shift 2
  local extra="{}"
  if [ $# -gt 0 ]; then
    local parts=""
    while [ $# -gt 0 ]; do
      parts="${parts}\"${1}\":\"${2}\","
      shift 2
    done
    extra="{${parts%,}}"
  fi
  msg="${msg//\"/\\\"}"
  printf '{"level":"%s","service":"context-manager.install","message":"%s","extra":%s}\n' \
    "$level" "$msg" "$extra" >&2
}

log info "installer started" target "$OPENCODE_DIR"

# ── 1. Plugin file ──
mkdir -p "$PLUGIN_DIR"
cp "$REPO_DIR/plugins/@madtech-opencode-context-manager-plugin.ts" "$PLUGIN_DIR/@madtech-opencode-context-manager-plugin.ts"
log info "plugin copied" file "$PLUGIN_DIR/@madtech-opencode-context-manager-plugin.ts"

# ── 1b. Source files (needed for relative imports) ──
cp -r "$REPO_DIR/src" "$PLUGIN_DIR/src"
log info "source copied" dir "$PLUGIN_DIR/src"

# ── 2. Ensure @opencode-ai/plugin is installed ──
if [ ! -d "$OPENCODE_DIR/node_modules/@opencode-ai/plugin" ]; then
  log warn "plugin dependency missing" package "@opencode-ai/plugin"
  if [ ! -f "$OPENCODE_DIR/package.json" ]; then
    if [ -f "$REPO_PKG" ]; then
      cp "$REPO_PKG" "$OPENCODE_DIR/package.json"
      log info "copied package.json" from "$REPO_PKG" to "$OPENCODE_DIR"
    else
      printf '{"dependencies":{"@opencode-ai/plugin":"latest"}}' > "$OPENCODE_DIR/package.json"
      log info "created package.json" target "$OPENCODE_DIR/package.json"
    fi
  fi
  if command -v bun >/dev/null 2>&1; then
    (cd "$OPENCODE_DIR" && bun install --silent)
    log info "dependency installed" package "@opencode-ai/plugin"
  else
    log error "bun not found"
    exit 1
  fi
fi

# ── 3. Add plugin to opencode config ──
add_plugin_to_config() {
  local cfg="$1" rel="$2" name="$3"
  bun -e '
    const fs = require("fs");
    const path = "'"$cfg"'";
    const rel = "'"$rel"'";
    const name = "'"$name"'";
    function jlog(level, msg, extra) {
      process.stderr.write(JSON.stringify({level, service: "context-manager.install", message: msg, extra: extra||{}}) + "\n");
    }
    let txt = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : null;

    if (txt && txt.includes(name)) {
      jlog("info", "plugin already in config", {path, name});
      process.exit(0);
    }

    let obj = {};
    if (txt && txt.trim() !== "") {
      try { obj = JSON.parse(txt); }
      catch (e) {
        const stripped = txt
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        try { obj = JSON.parse(stripped); } catch (e2) {
          jlog("error", "could not parse config", {path});
          process.exit(1);
        }
      }
    }

    if (!Array.isArray(obj.plugin)) obj.plugin = [];
    if (!obj.plugin.includes(rel)) obj.plugin.push(rel);

    if (!txt || txt.trim() === "") {
      obj["$schema"] = "https://opencode.ai/config.json";
    }

    const out = JSON.stringify(obj, null, 2) + "\n";
    fs.writeFileSync(path, out, "utf8");
    jlog("info", "plugin added to config", {path, plugin: rel});
  '
}

if [ -f "$CONFIG" ]; then
  add_plugin_to_config "$CONFIG" "$PLUGIN_REL" "$PLUGIN_NAME"
else
  cat > "$CONFIG" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_REL"]
}
EOF
  log info "config created" file "$CONFIG"
fi

log info "install complete" uninstaller "uninstall.sh"
