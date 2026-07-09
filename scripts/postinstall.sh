#!/bin/bash
set -euo pipefail

OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$OPENCODE_DIR/plugins"
SHIM_NAME="context-manager-loading-shim.ts"

# Find the bundled shim file (sibling of this script in the package)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SHIM_SRC="$PACKAGE_DIR/plugins/$SHIM_NAME"
SHIM_DST="$PLUGIN_DIR/$SHIM_NAME"

log() {
  printf '{"level":"%s","service":"context-manager.postinstall","message":"%s","extra":%s}\n' \
    "$1" "$2" "${3:-{}}" >&2
}

# ── Clean up upgrade markers from previous versions ──
# ponytail: only markers are cleaned here; cache deletion is handled by the
# shim's detached process. The postinstall runs inside the cache dir, so we
# must NOT delete the cache itself.
CACHE_DIR="${HOME}/.cache/opencode"
PENDING_UPGRADE="$CACHE_DIR/.context-manager-pending-upgrade"
VERSION_MARKER="$CACHE_DIR/.context-manager-version-check"

if [ -f "$PENDING_UPGRADE" ]; then
  log info "removing pending-upgrade marker" path "$PENDING_UPGRADE"
  rm -f "$PENDING_UPGRADE"
fi
if [ -f "$VERSION_MARKER" ]; then
  rm -f "$VERSION_MARKER"
fi

if [ ! -f "$SHIM_SRC" ]; then
  log error "shim source not found in package" path "$SHIM_SRC"
  exit 0  # don't fail npm install
fi

mkdir -p "$PLUGIN_DIR"

# Idempotent: skip if existing file already matches
if [ -f "$SHIM_DST" ]; then
  if cmp -s "$SHIM_SRC" "$SHIM_DST"; then
    log info "shim already up to date" path "$SHIM_DST"
    exit 0
  fi
fi

cp "$SHIM_SRC" "$SHIM_DST"
log info "shim installed" path "$SHIM_DST"
