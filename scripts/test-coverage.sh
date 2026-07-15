#!/usr/bin/env bash
set -euo pipefail

OUT=$(bun test --coverage packages/*/test apps/*/test 2>&1)
echo "$OUT"

# ponytail: parse the v8 coverage table; bail if any non-source line is below 100.
# Threshold syntax: every source file must show "100" in the % Stmts column.
# Bun's coverage report is text-only and stable across 1.x.
if echo "$OUT" | grep -E "^\s*[A-Za-z][^|]+\|\s*([0-9]{1,2}|[0-9]{1,2}\.[0-9]+)\s*\|" \
  | grep -v "All files" \
  | awk -F'|' '{ gsub(/ /,"",$2); if ($2+0 < 100) { print "Coverage below 100% for:", $1; bad=1 } } END { exit bad+0 }'; then
  echo "coverage OK"
else
  echo "coverage gate FAILED" >&2
  exit 1
fi
