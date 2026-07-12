#!/bin/bash
set -euo pipefail

TMPDIR=$(mktemp -d)
TARBALL=""
trap 'rm -rf "$TMPDIR"' EXIT

log() {
  printf '{"level":"%s","service":"test-pack","message":"%s"}\n' "$1" "$2" >&2
}

# 1. Build dashboard dist
log info "building dashboard dist..."
(cd dashboard && bun install 2>/dev/null && bun run build)

# 2. npm pack
log info "packing npm tarball..."
TARBALL=$(npm pack 2>/dev/null | tail -1)
TARBALL_PATH="$PWD/$TARBALL"
if [ ! -f "$TARBALL_PATH" ]; then
  log error "npm pack failed"
  exit 1
fi
log info "tarball: $TARBALL"

# 3. Verify tarball includes key files
log info "verifying tarball contents..."
MISSING=""
for f in \
  "package/dashboard/dist/index.html" \
  "package/dashboard/dist/assets" \
  "package/plugins/@madtech-opencode-context-manager-plugin.ts" \
  "package/src/plugin.ts" \
  "package/src/dashboard.ts" \
  "package/skills/context-manager/SKILL.md"
do
  if ! tar -tzf "$TARBALL_PATH" | grep -q "$f"; then
    log error "MISSING in tarball: $f"
    MISSING="$MISSING $f"
  fi
done

# 4. Verify excluded files are NOT in tarball
for f in \
  "dashboard/src" \
  "dashboard/node_modules" \
  "dashboard/vite.config.ts" \
  "dashboard/postcss.config.js" \
  "dashboard/tailwind.config.ts" \
  "dashboard/tsconfig.json" \
  "test" \
  "tsconfig.json"
do
  # Use a regex anchor to avoid partial matches
  # We check for lines like "package/<f>" or "package/<f>/something"
  if tar -tzf "$TARBALL_PATH" | grep -c "package/$f" > /dev/null 2>&1; then
    # Check if it's truly excluded (not a subdirectory like dashboard/src vs dashboard/src/foo)
    if tar -tzf "$TARBALL_PATH" | grep -E "^package/$f(/|$)" > /dev/null 2>&1; then
      log error "SHOULD BE EXCLUDED but found: $f"
      MISSING="$MISSING (should exclude: $f)"
    fi
  fi
done

# 5. Install in temp dir and verify structure
log info "installing to temp dir..."
cd "$TMPDIR"
npm init -y >/dev/null 2>&1
npm install "$TARBALL_PATH" >/dev/null 2>&1

PKG_DIR="node_modules/@madtech/opencode-context-manager-plugin"
for f in \
  "dashboard/dist/index.html" \
  "plugins/@madtech-opencode-context-manager-plugin.ts" \
  "src/plugin.ts" \
  "skills/context-manager/SKILL.md"
do
  if [ ! -f "$PKG_DIR/$f" ]; then
    log error "MISSING after install: $f"
    MISSING="$MISSING (post-install: $f)"
  fi
done

cd "$OLDPWD"

if [ -n "$MISSING" ]; then
  log error "FAILED"
  echo "❌ Package test FAILED"
  exit 1
fi

log info "all checks passed"
echo "✅ Package test passed"
