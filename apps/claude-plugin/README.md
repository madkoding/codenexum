# @codenexum/claude-plugin — Claude Code CodeNexum hook

Equivalent of `apps/plugin` (the opencode plugin) but for [Claude Code](https://claude.com/claude-code): a small Node.js script, registered as a Claude Code **hook**, that talks HTTP to the same local CodeNexum Electron app. No changes to `apps/electron`, `packages/core`, or `packages/sql` — this is purely a new client.

Claude Code doesn't have a plugin system that transparently swaps out native tools like opencode does. It does, however, let a `PostToolUse` hook replace a tool's output (`updatedToolOutput`), which is enough to replicate the same substitution behavior.

## ⚠️ Status: project-level install only, not global

This has **not** been installed as a global hook (`~/.claude/settings.json`) yet. It's meant to be validated on one test project first — see [Installing](#installing) below. Read this before installing anywhere with sensitive/production code:

- CodeNexum's local server (default `127.0.0.1:7770`, but the real port is
  read from `~/.config/codenexum/mcp.json` at hook time, so it tracks whatever
  port the Electron app ended up on) has **no authentication**. This hook only
  talks to it over loopback, but the server itself trusts any local process.
- To limit what can end up in CodeNexum's local SQLite index / snippet cache, this hook **never** forwards paths matching a denylist (`.env`, `.aws/`, `.ssh/`, `*.pem`, `*.key`, `.git/`, `credentials*`, `cdk.context.json`, `cdk.out/`) — see `src/denylist.ts`.
- The Bash compression allowlist is intentionally **smaller** than the one in `apps/plugin`: `curl`, `wget`, `ssh`, `scp` were dropped on purpose (their stdout is the most likely to contain live credentials).
- Every substitution is appended to `~/.codenexum/audit.log` (JSONL) so you can inspect exactly what got swapped in for what.
- No telemetry, no calls to any host other than `127.0.0.1` — verified by reading the full source of `apps/electron`.

## How it works

1. **`SessionStart`** — calls `cm_analyze` once, to make sure the current project is indexed (mirrors `runInitialAnalyze()` in `apps/plugin`).
2. **`PostToolUse`** (matcher `Read|Grep|Glob|Bash|Write|Edit`):
   - `Write`/`Edit` — not compressed, just recorded (see anti-stale below).
   - `Read` → `cm_read_snippet`, `Grep`/`Glob` → `cm_search_snippet`, `Bash` (only `git`/`npm`/`yarn`/`pnpm`/`node`/`npx`/`tsc`/`test`/`jest`/`vitest`/`pytest`/`cargo`/`build`/`make`/`cmake`, or a `cat`/`head`/`tail` inside Bash treated as a Read) → `cm_compress_output`.
   - If the local server returns something shorter than the original output, the hook emits `updatedToolOutput` to replace it. Otherwise the original output passes through untouched.
3. **Guards, all evaluated before any network call:**
   - **Denylist** (`src/denylist.ts`) — sensitive paths are never sent to CodeNexum, substitution or not.
   - **Anti-stale** (`src/session-store.ts`) — if a file was `Write`/`Edit`-ed earlier in the same Claude Code session, a later `Read` of it is never substituted (the local index may not have caught up with the edit yet — there's no freshness metadata to check otherwise).
   - **Timeout** — every call to the local server uses a 300ms `AbortSignal.timeout`. If CodeNexum isn't running or hangs, the hook fails open silently (exits 0, no output) rather than blocking the tool call.

## Building

```sh
cd apps/claude-plugin
bun run build    # tsc -> dist/*.js (also compiles src/install.ts -> dist/install.js)
bun run bundle   # bun build -> dist/hook.mjs (single file, what actually gets installed)
```

`scripts/install.mjs` imports the merge logic from `dist/install.js`, so
`bun run build` must be run at least once before `install.mjs` will work.
The bundle (`bun run bundle`) is only needed when you actually want to
install the hook; tests don't need it.

## Installing (project-level, one repo at a time)

```sh
node apps/claude-plugin/scripts/install.mjs /path/to/a/test/project
# or
node apps/claude-plugin/scripts/install.mjs /path/to/a/test/project --force
```

This:
1. Computes a sha1 of `dist/hook.mjs`. If the same hash is already in
   `~/.codenexum/hook.mjs`, skips the copy.
2. Reads the existing `<project>/.claude/settings.json` (if any) and merges
   in `SessionStart` and `PostToolUse` hook entries pointing at
   `node ~/.codenexum/hook.mjs` — it does **not** overwrite any hooks or
   settings you already have there. If the resulting JSON is identical to
   the current file, the write is skipped.
3. Backs up the previous `settings.json` to `.bak.<timestamp>` only when the
   merge actually changed something. Old `.bak.*` files in the same
   directory are removed first, so only the most recent backup is kept.
4. Detects whether a `claude` process is already running and prints a
   warning reminding you to start a new Claude Code session in the project
   to pick up the hook.

It only ever touches the **one project you point it at**. It does not write
to `~/.claude/settings.json`.

The script is idempotent: re-running it with no changes prints
"already up to date" for both the hook and the settings, and exits 0.
Pass `--force` to reinstall even when nothing changed (useful after
rebuilding the bundle).

Requires the CodeNexum Electron app to be running (tray icon, serving on
`127.0.0.1:<port>`). The hook reads the actual port from
`~/.config/codenexum/mcp.json` on every call, so you do not need to know it
in advance. If the app is not running, the hook just no-ops.

## Testing

```sh
bun test apps/claude-plugin/test
```

Covers the denylist patterns, the Read/Grep/Glob/Bash detection logic (including that `curl`/`ssh`/`scp`/`wget` are excluded), the anti-stale session store, and the `install.mjs` merge + idempotency logic.
