# AGENTS.md — opencode-codenexum

> Code index + context compression engine for [opencode](https://opencode.ai).
> Indexes projects, answers semantic code queries, compresses tool outputs to stay under token limits.
> Version 3.0.0 (Electron + MCP rewrite, in progress on `develop`).

---

## Repository status

- **Branch:** `develop` (working tree has uncommitted changes — a v3 refactor in progress).
- **v3 layout**: split into `apps/` (electron + plugin) and `packages/` (core + sql).

---

## Monorepo structure (v3, current)

```
package.json              # @codenexum/electron root, "main": "dist/main/index.cjs", private
bun.lock                  # bun workspaces: apps/electron, apps/plugin, packages/core, packages/sql, packages/mcp-protocol
tsconfig.json             # bundler resolution, strict, paths: @codenexum/core|sql|plugin|electron

packages/
  core/                   # Pure logic, no I/O. types, tokenizer, format, search, resolve, context.
    src/types.ts          # Chunk, SearchResult, IGNORE, CODE_EXTS
    src/tokens.ts         # LazyTiktokenTokenizer (cl100k_base) + HeuristicTokenizer (4 chars/token)
    src/search.ts         # parseQuery: terms + filters (type:/file:/lang:); buildSearchQuery
    src/format.ts         # formatSearchResult[s] (grouped when >=5), relativePath, snippet lines
    src/resolve.ts        # parseSymbolRef (file.ts:symbolName → {file,name}); resolvePossibleFile
    src/context.ts        # ConversationContext (sliding user-text terms; gated by CODENEXUM_SMART_READ=1)
  sql/                    # SQLite layer. better-sqlite3 / node:sqlite; SCHEMA_VERSION=3
    src/store.ts          # initSchema, dbInsertChunks, dbSearch (FTS5 + BM25 trigram), dbFindRelated, dbFindImpacted
    src/edges.ts          # extractEdges: import/call/extend/implement/reference from chunks
    src/node-sqlite.ts    # Tiny shim over node:sqlite DatabaseSync (so we can swap to better-sqlite3)
    src/types.ts          # Chunk re-export, IGNORE, CODE_EXTS (slightly larger than core's)
    src/parsers/          # One file per language. PARSERS map: py|js|ts|jsx|tsx|go|rs|java|rb|php|cpp|cs|css|scss|html|json|yaml|toml|sql|md
    src/tokens.ts         # Local re-implementation of tokenizer (do not import this one from core — use @codenexum/core/tokens)
    src/index.ts          # re-exports store + edges + parsers
  mcp-protocol/           # Referenced in bun.lock but no source files present yet. Treat as placeholder.

apps/
  electron/               # @codenexum/electron — main process, MCP server, React renderer (1500 LOC target)
    src/main/index.ts     # App entry: tray, single-instance lock, installOpencodePlugin, starts MCP server
    src/preload/index.ts  # contextBridge → window.electronAPI.{invoke, getMcpUrl}
    src/mcp/
      server.ts           # HTTP server (port 7770, +1 on EADDRINUSE). Tools/call + JSON-RPC + SSE.
      indexer.ts          # walk(), indexProject(), updateFile(), debouncedUpdateFile() — uses @codenexum/core IGNORE/CODE_EXTS
      auto-register.ts    # ensureProject(): hash path → register in registry.sqlite
      db-paths.ts         # getUserDataDir, getRegistryPath, getProjectDbPath (sha1[:16].sqlite)
      compress.ts         # compressToolOutput (truncate + ansi/dedupe/stack), compressToolOutputSemantic
      usage.ts            # logEvent → usage_events table; getUsageSummary
      stats.ts            # getProjectStats, getProjectAggregate, getCompressionStatus, getDashboardState, getGlobalAnalytics
      settings.ts         # Settings: readInterception, grepInterception, autoCompress, semanticCompression, etc.
      cache.ts            # In-memory rawCache (200 entries, 5min TTL)
      index.ts            # Re-exports startMcpServer
    src/renderer/         # React 19 + react-router-dom + recharts + lucide-react + tailwind
      main.tsx            # HashRouter: /, /project/:id, /settings
      App.tsx             # Sidebar + Outlet + ProjectSettingsModal
      pages/ProjectsPage.tsx        # Global dashboard: hero metrics, cumulative savings, activity, top queries, savings by mechanism, index health
      pages/ProjectDetailPage.tsx   # Per-project: hero metrics, savings, top files, types, languages, recent activity
      pages/SettingsPage.tsx        # 11 toggles in 4 categories (intercept, compress, cache, telemetry) + 3 numeric fields
      components/Sidebar.tsx        # Project list, MCP-connected indicator, delete button
      components/Topbar.tsx
      components/ProjectSettingsModal.tsx
      components/ui.tsx             # Card, EmptyState
      hooks/useWebSocket.tsx        # EventSource on /api/events → window 'cm-data' events
      lib/format.ts                 # fmt, fmtK, pct, relTime
      types.ts                      # Project, ProjectStats, AggregateData
      index.html, index.css, main.tsx
  plugin/                 # @codenexum/plugin — thin MCP client (~120 LOC) loaded by opencode
    src/index.ts          # Discovers MCP url, registers 7 context_* tools, intercepts read/bash/grep/glob

test/
  benchmark.ts            # Imports mcp/prompt + mcp/compact (DOES NOT EXIST YET — broken)
  contracts.test.ts       # Same
  integration.test.ts     # Same
  tokenize.py             # Standalone Python tokenizer service (cl100k_base); not wired to anything currently
  *.test.ts files in git history were deleted during v3 refactor

scripts/
  test-pack.sh            # OLD v2 packaging test, references deleted files (ignore)

.opencode/                # Local dev config (gitignored now). opencode.json registers @codenexum/plugin + MCP server at 7770
```

---

## MCP tool inventory (apps/electron/src/mcp/server.ts)

| Tool | Purpose | Required args |
|---|---|---|
| `cm_projects_list` | List all registered projects with chunks/files counts | — |
| `cm_projects_get` | Get one project | `id` |
| `cm_projects_delete` | Delete project + its sqlite | `id` |
| `cm_projects_update` | Rename project | `id`, `name` |
| `cm_settings_get` / `cm_settings_set` | Read/write Settings (stored in userData/settings.json) | `settings` (set) |
| `cm_stats` | Per-project: chunks, files, edges, lastIndexed, topFiles, languages, usage summary | `path` (optional, uses most-recent) |
| `cm_aggregate` | byType, byLang, topFiles | `path` |
| `cm_compression` | { active, semanticSaved, selfTest, modes } | — |
| `cm_dashboard` | { projects, global, compression } | — |
| `cm_analytics` | activityTimeline (24h hourly), cumulativeSavings, topQueries, recentActivity, indexHealth, hotFiles | — |
| `cm_analyze` | Walk + parse + write to sqlite | `path` |
| `cm_search` | FTS5+BM25 search | `path`, `query`, `n?` |
| `cm_related` | Callers/callees/imports/extends/implements for file.ts:symbol | `path`, `symbol` |
| `cm_impact` | Files depending on given files | `path`, `files[]` |
| `cm_log_event` | Log usage event | `projectDir`, `eventType` |
| `cm_read_snippet` | Replace `read` output with indexed chunk summary | `path`, `filePath`, `offset?`, `limit?`, `maxBodyLines?` |
| `cm_search_snippet` | Compact grep/glob replacement | `path`, `query`, `fileFilter?` |
| `cm_cache_get` / `cm_cache_put` | In-memory rawCache (5min TTL, 200 max) | `key` (+ `output`, `fileHash` for put) |
| `cm_compress_output` | ansi/dedupe/stack + truncate; or semantic if enabled | `toolID`, `output`, `semantic?` |

Transport: HTTP. Endpoints:
- `POST /tools/call` — custom RPC with `{tool, args}` body
- `POST /messages` or `/mcp` — JSON-RPC 2.0 (initialize, tools/list, tools/call, notifications/initialized, ping)
- `GET /sse` and `/` — MCP SSE transport with `/messages?sessionId=...` POST endpoint
- `GET /api/settings` — settings JSON for plugin
- `GET /api/events` — EventSource for dashboard live updates
- `GET /health` — health check (used by main process to wait for ready)

SSE clients are tracked in `sseClients` map; broadcasts go to all (`sseBroadcast`). `sseBroadcast("usage", ...)` fires on search/related/impact/compression events.

---

## How data flows

1. opencode loads `@codenexum/plugin` (apps/plugin/src/index.ts).
2. Plugin discovers MCP URL from `CODENEXUM_MCP_URL` env, then `~/.config/codenexum/mcp.json`, then default `http://127.0.0.1:7770`.
3. On `init()`, plugin calls `cm_analyze` for `process.cwd()` to build/refresh the index.
4. On `tool.execute.before`: plugin records candidates (`read` → file path, `grep`/`glob` → pattern, `bash` matching `cat|head|tail` → file path) in `pendingCalls`.
5. On `tool.execute.after`:
   - If candidate → call `cm_read_snippet` or `cm_search_snippet`; if smaller than native output, substitute and log `index_substitute` + `file_read`.
   - Else if `autoCompress` and output > `compressThreshold` (default 8000) and tool is compressible → call `cm_compress_output` and substitute; log `compression`.
6. On `session.idle`: flush per-session `turn_savings` to MCP.
7. Electron main (apps/electron/src/main/index.ts) registers itself in `~/.config/opencode/opencode.jsonc` on first launch (also installs plugin dist to `~/.config/opencode/plugins/node_modules/@codenexum/plugin`).

---

## SQLite schema (SCHEMA_VERSION=3)

Per-project DB: `userData/projects/<sha1[:16]>.sqlite`
Registry DB: `userData/registry.sqlite`

`chunks_fts` (FTS5 with `tokenize='trigram'`): name, content, id UNINDEXED, file UNINDEXED, type UNINDEXED, line UNINDEXED, lineEnd UNINDEXED, body UNINDEXED, lang UNINDEXED
`file_hashes` (file PK → sha256): for incremental re-index
`meta` (key → value): schema_version, lastIndexed, projectRoot
`edges` (source_file, source_symbol, target_file, target_symbol, kind): for related/impact, indexes on source + target
`usage_events` (id, event_type, tokens_saved, tokens_used, meta, ts): per-project telemetry

Registry: `projects` (id PK = sha1[:16], path UNIQUE, name, dbPath, lastSeen). Stale/tmp paths are GC'd on list.

---

## Key environment variables (CONFIG.md)

- `CODENEXUM_MCP_PORT` (7770) — Electron MCP server port
- `CODENEXUM_MCP_URL` — override MCP URL (skips discovery)
- `CODENEXUM_TOKENIZER` (`tiktoken`) — `tiktoken` or `estimate`
- `CODENEXUM_TOKEN_CACHE_SIZE` (200) — LRU
- `CODENEXUM_SNIPPET_LINES` (12) — default snippet length
- `CODENEXUM_INTERCEPT_MODE` (`substitute`) — `off|warn|substitute`
- `CODENEXUM_INTERCEPT_BASH` (1) — gate bash cat/head/tail interception
- `CODENEXUM_TOOL_MAX_LINES_{READ|BASH|GREP|GLOB}` (25|30|25|50)
- `CODENEXUM_SEMANTIC_COMPRESS` (1)
- `CODENEXUM_GROUP_RESULTS` (1) — group search results by file when 5+
- `CODENEXUM_COMPACT_AT` (0.6) — context fill threshold (legacy, not wired in v3)
- `CODENEXUM_CACHE_DIR` (`~/.cache/opencode`) — v2 only, v3 uses Electron userData
- `CODENEXUM_MAX_FILES` (10000), `CODENEXUM_MAX_FILE_BYTES` (1MiB)
- `CODENEXUM_SMART_READ` — gate ConversationContext (smart read mode, v2)

---

## v2 → v3 deltas to know

- `install.sh`/`uninstall.sh` → moved into Electron `main/index.ts` (auto on app launch).
- Dashboard was a separate Vite app in `dashboard/` → now the Electron renderer.
- `src/store.ts` (single plugin) → split: schema/FTS in `@codenexum/sql`, plugin-shared logic in `@codenexum/core`.
- MCP transport was WebSocket (`ws://…`) → now streamable HTTP (JSON-RPC + SSE) at `http://…`.
- Registry was one SQLite → still one, but per-project DBs under `userData/projects/`.
- DB location: `~/.cache/opencode/...` → `app.getPath('userData')/...` (Electron).
- Old plugin path `@madtech/opencode-codenexum-plugin` → new path `@codenexum/plugin` (auto-cleaned on install).
- Single-instance lock via `app.requestSingleInstanceLock()`.
- "Project registry" v2 used `(name, dbPath, lastSeen)`; v3 added `id` (sha1 of path[:16]) as PK and unique `path` constraint.

---

## Coding conventions

- **No comments unless asked** (ponytail mode active).
- TypeScript strict, ESNext, bundler resolution. Workspaces in `bun.lock` not `package.json` workspaces field — the lockfile IS the workspace declaration.
- Path aliases in tsconfig: `@codenexum/core`, `@codenexum/sql`, `@codenexum/plugin`, `@codenexum/electron` map to `packages/*/src` and `apps/*/src`.
- `apps/electron` builds to `dist/{main,preload,renderer}/` (electron-vite expected but config not in tree).
- The MCP server uses `node:sqlite` (Node 22+), not `better-sqlite3`. Shim in `packages/sql/src/node-sqlite.ts` keeps an interface compat.
- React 19 + Vite for the renderer. Tailwind for styling. No UI lib — hand-rolled `Card`, `EmptyState`, `HeroMetric`, `MiniRing`, `ProgressList`, `SavingsMechanismChart` in `components/ui.tsx` and inline.
- `recharts` for charts. `lucide-react` for icons.
- `index.css` is just `@tailwind base/components/utilities` + a thin scrollbar utility.

---

## Common gotchas

- **Don't import from `@codenexum/sql/tokens` or `packages/sql/src/tokens.ts`** — there's a duplicate tokenizer in sql/. Use `@codenexum/core` tokens.
- **`ignore` lists differ slightly**: `core/src/types.ts` and `sql/src/types.ts` both export `IGNORE`/`CODE_EXTS` but with tiny differences (sql has `.xml`, `.txt`, `.css`, `.scss`; core doesn't). `indexer.ts` uses `@codenexum/core` for walk filtering — sql's set is what parsers cover, not what gets walked.
- **node:sqlite vs better-sqlite3**: SCHEMA_VERSION=3 schema is portable. If a v2 DB exists in `~/.cache/opencode/codenexum-*.sqlite`, the main process cleans it on first launch.
- **Ports in use**: MCP server auto-increments to `port+1` on EADDRINUSE and writes the actual port to `~/.config/codenexum/mcp.json` + updates `opencode.jsonc` MCP entry.
- **SSE keepalive**: 15s ping. Clients reconnect on `EventSource.onerror`.
- **Tool result wrappers**: `cm_*` tools return `{ result, ... }` or `{ error, ... }` via the custom `/tools/call` route. JSON-RPC wraps in `{ content: [{ type: "text", text: ... }] }`. Plugin tolerates both via `data.result ?? data`.
- **`@codenexum/core` size budget**: `core/src/tokens.ts` uses `require("gpt-tokenizer/...")` at runtime (not a declared dep) so it falls back silently to 4-chars/token if the package isn't installed. Don't add it to package.json.

---

## Verification commands

```bash
bun install                  # workspace install
bun run typecheck            # tsc -b across all packages (only what tsconfig.json includes)
bun test                     # bun:test — but see broken tests above
bun test/benchmark.ts        # broken: missing mcp/prompt + mcp/compact
bun run --filter @codenexum/electron dev      # electron-vite dev
bun run --filter @codenexum/electron package  # build distributable
```

Typecheck target: `packages/*/src/**/*` and `apps/*/src/**/*` per root `tsconfig.json`. `dist/` is gitignored; main process is bundled to `dist/main/index.cjs` (current root `package.json` `main` field).

---

## When in doubt

- The Electron app is the source of truth for tools/registry/SQL. The plugin is intentionally minimal.
- The dashboard reads via `POST /tools/call` against the MCP server, not direct sqlite. That keeps it in lock-step with what the plugin sees.
- `cm_*` tool names are server-side; plugin exposes them as `context_*` to opencode (mapping in `apps/plugin/src/index.ts` `tool:` block).
- v2 code paths referenced from docs (e.g. `~/.cache/opencode`, `install.sh`, `dashboard/dist`) are no-ops now. Update or remove them rather than resurrecting.
