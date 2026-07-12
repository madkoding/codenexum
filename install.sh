#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
case "$OPENCODE_DIR" in
  *[\"\'\!\`$]*)
    echo "ERROR: OPENCODE_DIR contains unsafe characters" >&2
    exit 1
    ;;
esac
PLUGIN_DIR="$OPENCODE_DIR/plugins"
CONFIG="$OPENCODE_DIR/opencode.jsonc"
SHIM_NAME="context-manager-loading-shim"
SHIM_FILE="$SHIM_NAME.ts"
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

# ── 1. Loading shim ──
mkdir -p "$PLUGIN_DIR"
cp "$REPO_DIR/plugins/context-manager-loading-shim.ts" "$PLUGIN_DIR/$SHIM_FILE"
log info "shim copied" file "$PLUGIN_DIR/$SHIM_FILE"

# ── 2. Ensure @opencode-ai/plugin is installed in opencode dir ──
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

# ── 3. Add only the shim to opencode config ──
add_shim_to_config() {
  local cfg="$1" shim="$2"
  CFG="$cfg" SHIM="$shim" bun -e '
    const fs = require("fs");
    const path = process.env.CFG;
    const shim = process.env.SHIM;
    function jlog(level, msg, extra) {
      process.stderr.write(JSON.stringify({level, service: "context-manager.install", message: msg, extra: extra||{}}) + "\n");
    }
    let txt = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : null;

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

    let changed = false;
    if (!Array.isArray(obj.plugin)) obj.plugin = [];
    // Remove stale context-manager plugin entries (old direct references)
    obj.plugin = obj.plugin.filter(p => !p.includes("context-manager") || p === shim);
    if (!obj.plugin.includes(shim)) {
      obj.plugin.push(shim);
      changed = true;
    }

    if (!obj.permission) obj.permission = {};
    if (!obj.permission.skill) obj.permission.skill = {};
    if (!obj.permission.skill["context-manager"]) {
      obj.permission.skill["context-manager"] = "allow";
      changed = true;
    }

    if (!txt || txt.trim() === "") {
      obj["$schema"] = "https://opencode.ai/config.json";
      changed = true;
    }

    if (!changed) {
      jlog("info", "shim already in config", {path, shim});
      process.exit(0);
    }

    const out = JSON.stringify(obj, null, 2) + "\n";
    if (txt) fs.copyFileSync(path, path + ".bak");
    const tmp = path + ".tmp";
    fs.writeFileSync(tmp, out, "utf8");
    fs.renameSync(tmp, path);
    jlog("info", "shim added to config", {path, shim});
  '
}

if [ -f "$CONFIG" ]; then
  add_shim_to_config "$CONFIG" "$SHIM_NAME"
else
  cat > "$CONFIG" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$SHIM_NAME"]
}
EOF
  log info "config created" file "$CONFIG"
fi

log info "install complete" uninstaller "uninstall.sh"

# Clean stale test projects from registry
REGISTRY_DB="$HOME/.cache/opencode/context-manager-registry.sqlite"
if [ -f "$REGISTRY_DB" ]; then
  sqlite3 "$REGISTRY_DB" "DELETE FROM projects WHERE name LIKE 'test-%'; DELETE FROM usage_events WHERE project_id IN (SELECT id FROM projects WHERE name LIKE 'test-%');" 2>/dev/null
fi
