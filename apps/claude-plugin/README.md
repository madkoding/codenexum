# @codenexum/claude-plugin — Claude Code CodeNexum hook

Equivalent of `apps/plugin` (the opencode plugin) but for [Claude Code](https://claude.com/claude-code): a small Node.js script, registered as a Claude Code **hook**, that talks HTTP to the same local CodeNexum Electron app. No changes to `apps/electron`, `packages/core`, or `packages/sql` — this is purely a new client.

Claude Code doesn't have a plugin system that transparently swaps out native tools like opencode does. It does, however, let a `PostToolUse` hook replace a tool's output (`updatedToolOutput`), which is enough to replicate the same substitution behavior.

## ⚠️ Status: project-level install only, not global

This has **not** been installed as a global hook (`~/.claude/settings.json`) yet. It's meant to be validated on one test project first — see [Installing](#installing) below. Read this before installing anywhere with sensitive/production code:

- CodeNexum's local server (`127.0.0.1:7770`) has **no authentication**. This hook only talks to it over loopback, but the server itself trusts any local process.
- To limit what can end up in CodeNexum's local SQLite index / snippet cache, this hook **never** forwards paths matching a denylist (`.env`, `.aws/`, `.ssh/`, `*.pem`, `*.key`, `.git/`, `credentials*`, `cdk.context.json`, `cdk.out/`) — see `src/denylist.ts`.
- The Bash compression allowlist is intentionally **smaller** than the one in `apps/plugin`: `curl`, `wget`, `ssh`, `scp` were dropped on purpose (their stdout is the most likely to contain live credentials).
- Every substitution is appended to `~/.codenexum/audit.log` (JSONL) so you can inspect exactly what got swapped in for what.
- No telemetry, no calls to any host other than `127.0.0.1` — verified by reading the full source of `apps/electron`.

## How it works

1. **`SessionStart`** — calls `cm_analyze` once, to make sure the current project is indexed (mirrors `runInitialAnalyze()` in `apps/plugin`).
2. **`PostToolUse`** (matcher `Read|Grep|Glob|Bash|Write|Edit`):
   - `Write`/`Edit` — not compressed, just recorded (see anti-stale below).
   - `Read` → `cm_read_snippet`, `Bash` (only `git`/`npm`/`yarn`/`pnpm`/`node`/`npx`/`tsc`/`test`/`jest`/`vitest`/`pytest`/`cargo`/`build`/`make`/`cmake`, or a `cat`/`head`/`tail` inside Bash treated as a Read) → `cm_compress_output`.
   - **`Grep`/`Glob` are never substituted.** Claude Code validates a `PostToolUse` hook's `updatedToolOutput` against the *original* tool's response shape (confirmed live via `claude -d hooks`). `Read`'s response is `{ type, file: { content, ... } }` and `Bash`'s is `{ stdout, ... }` — both reconstructable by swapping one field (see `src/substitute.ts`). `Grep`/`Glob` return `{ filenames, numFiles, totalFiles }`, a structured list with no free-text field, so CodeNexum's formatted search-index text has nowhere faithful to go.
   - If the local server returns something shorter than the original output, the hook emits `updatedToolOutput` (reconstructing the tool's native shape) to replace it. Otherwise the original output passes through untouched.
3. **Guards, all evaluated before any network call:**
   - **Denylist** (`src/denylist.ts`) — sensitive paths are never sent to CodeNexum, substitution or not.
   - **Anti-stale** (`src/session-store.ts`) — if a file was `Write`/`Edit`-ed earlier in the same Claude Code session, a later `Read` of it is never substituted (the local index may not have caught up with the edit yet — there's no freshness metadata to check otherwise).
   - **Timeout** — every call to the local server uses a 300ms `AbortSignal.timeout`. If CodeNexum isn't running or hangs, the hook fails open silently (exits 0, no output) rather than blocking the tool call.

## Building

```sh
cd apps/claude-plugin
bun run build    # tsc -> dist/*.js
bun run bundle   # bun build -> dist/hook.mjs (single file, what actually gets installed)
```

## Installing (project-level, one repo at a time)

```sh
node apps/claude-plugin/scripts/install.mjs /path/to/a/test/project
```

This:
1. Copies `dist/hook.mjs` to `~/.codenexum/hook.mjs` (shared location, not project-specific).
2. Backs up `<project>/.claude/settings.json` if it exists.
3. Merges in `SessionStart` and `PostToolUse` hook entries pointing at `node ~/.codenexum/hook.mjs` — it does **not** overwrite any hooks you already have there.

It only ever touches the **one project you point it at**. It does not write to `~/.claude/settings.json`.

Requires the CodeNexum Electron app to be running (tray icon, serving on `127.0.0.1:7770`) — if it's not, the hook just no-ops.

## Testing

```sh
bun test apps/claude-plugin/test
```

Covers the denylist patterns, the Read/Bash detection logic (including that `curl`/`ssh`/`scp`/`wget` are excluded, and that Grep/Glob never produce a candidate), the anti-stale session store, and the shape-reconstruction logic against real captured Read/Bash response shapes.

## Savings per session

CodeNexum's own dashboard only shows cumulative totals per project, with no per-session breakdown. Every substitution is appended to `~/.codenexum/audit.log` with its `sessionId`, so:

```sh
node apps/claude-plugin/scripts/session-report.mjs                 # table of all sessions, most recent first
node apps/claude-plugin/scripts/session-report.mjs <sessionId>     # per-file/command detail for one session (prefix match ok)
```
