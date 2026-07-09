#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SKILL_DIR="$OPENCODE_DIR/skills/context-manager"
CONFIG="$OPENCODE_DIR/opencode.jsonc"
PLUGIN_FILE="$PLUGIN_DIR/@madkoding-context-manager.ts"
PLUGIN_NAME="madkoding-context-manager"

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
  printf '{"level":"%s","service":"context-manager.uninstall","message":"%s","extra":%s}\n' \
    "$level" "$msg" "$extra" >&2
}

log info "uninstaller started" plugin "$PLUGIN_FILE"

# ── Remove plugin file ──
if [ -f "$PLUGIN_FILE" ]; then
  rm -f "$PLUGIN_FILE"
  log info "plugin removed" file "$PLUGIN_FILE"
fi

# ── Remove skill ──
if [ -d "$SKILL_DIR" ]; then
  rm -rf "$SKILL_DIR"
  log info "skill removed" dir "$SKILL_DIR"
fi

# ── Remove from config (robust, via bun) ──
if [ -f "$CONFIG" ]; then
  bun -e '
    const fs = require("fs");
    const path = "'"$CONFIG"'";
    const name = "'"$PLUGIN_NAME"'";
    function jlog(level, msg, extra) {
      process.stderr.write(JSON.stringify({level, service: "context-manager.uninstall", message: msg, extra: extra||{}}) + "\n");
    }
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
    jlog("info", "plugin removed from config", {path});
  '
fi

log info "uninstall complete"
