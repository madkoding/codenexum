# AGENTS.md — CodeNexum

> Code index + context compression engine for [opencode](https://opencode.ai).
> Indexes projects, answers semantic code queries, compresses tool outputs to stay under token limits.
> v0.99.3 — Electron + MCP rewrite on `develop`.

---

## Repository

- **Branch:** `develop` (uncommitted v3 refactor in progress)
- **Package manager:** Bun (workspaces via `bun.lock`)
- **Root package.json** `@codenexum/electron` (private), `"main": "dist/main/index.cjs"`

## Monorepo structure

```
package.json              # Root: @codenexum/electron, workspaces: apps/* + packages/*
bun.lock                  # Workspace lockfile (declares workspaces, NOT package.json workspaces field)
tsconfig.json             # Strict, bundler resolution, paths: @codenexum/{core,sql,plugin,electron}
AGENTS.md                 # This file
README.md                 # Main documentation
icon.png                  # App icon
skills/codenexum/SKILL.md # opencode skill for context management

packages/
  core/                   # ~/packages/core/src
    index.ts              # Re-exports all modules
    types.ts              # Chunk, SearchResult, IGNORE, CODE_EXTS
    tokens.ts             # LazyTiktokenTokenizer + HeuristicTokenizer (~4 chars/token)
    search.ts             # parseQuery (terms + type:/file:/lang: filters)
    format.ts             # formatSearchResult[s] with optional grouping (>=5 results)
    resolve.ts            # parseSymbolRef (file.ts:symbol), resolvePossibleFile
    context.ts            # ConversationContext (sliding user-text window, gated by CODENEXUM_SMART_READ)

  sql/                    # ~/packages/sql/src
    index.ts              # Re-exports store + edges + parsers
    types.ts              # Chunk (identical to core), IGNORE, CODE_EXTS (adds .xml, .txt)
    store.ts              # SCHEMA_VERSION=3, initSchema, dbInsertChunks, dbSearch (FTS5+BM25 trigram),
                          # dbFindRelated, dbFindImpacted, dbGetChunksForFile, dbStatsByLang, dbTopFiles
    edges.ts              # extractEdges: import/call/extend/implement references from chunks
    node-sqlite.ts        # Not present — db-pool wraps node:sqlite DatabaseSync directly with LRU cache
    parsers/              # One file per language family
      index.ts            # PARSERS map: .py|.js|.jsx|.ts|.tsx|.go|.rs|.java|.rb|.php|.c|.h|.cpp|.hpp|.cs|
                          #         .css|.scss|.html|.hbs|.ejs|.json|.yaml|.yml|.toml|.sql|.md
      common.ts           # lineOf, createLineResolver, findBlockEndByBrace/Indent/EndKeyword, bodyOf, makeChunk
      python.ts           # pyParse: classes, methods, decorators, imports
      javascript.ts       # jsParse + tsParse: functions, classes, methods, imports, exports, decorators
      go.ts               # goParse: functions, structs, interfaces, imports
      rust.ts             # rsParse: structs, enums, traits, impl blocks, functions, imports, exports
      java.ts             # javaParse: classes, interfaces, enums, methods, imports
      ruby.ts             # rbParse: classes/modules, methods, require/include
      php.ts              # phpParse: classes, interfaces, traits, enums, functions, imports
      cpp.ts              # cppParse: classes, structs, namespaces, enums, functions, includes
      csharp.ts           # csParse: classes, structs, records, interfaces, enums, methods, usings
      formats.ts          # cssParse (selectors), htmlParse (components, data-testid),
                          # dataParse (json/yaml/toml keys), sqlParse (CREATE TABLE/INDEX),
                          # mdParse (headings)

apps/
  electron/               # @codenexum/electron — Electron app (main + MCP + React dashboard)
    package.json          # electron-vite + electron-builder, deps: @codenexum/core|sql, react 19, recharts
    src/
      main/
        index.ts          # App entry: single-instance lock, installOpencodePlugin, cleanOldDatabases,
                          # startContextManagerMcp, BrowserWindow (1200x800), tray icon, close-to-tray,
                          # UpdateManager init, IPC handlers (update:*), before-quit → quitAndInstall
        icon.ts           # getAppIcon: nativeImage from build/icon.png with fallbacks
        updater.ts        # UpdateManager class wrapping electron-updater: check/download/install,
                          # status broadcast via webContents.send("update:status-changed")
      preload/
        index.ts          # contextBridge → window.electronAPI.{invoke, getMcpUrl, update.{check,download,install,getStatus,onStatusChange}}
      mcp/
        index.ts          # Re-exports startContextManagerMcp
        server.ts         # HTTP server on CODENEXUM_MCP_PORT (7770, +1 on EADDRINUSE). Endpoints:
                          #   POST /tools/call — custom RPC {tool, args}
                          #   POST /messages|/mcp — JSON-RPC 2.0 (initialize, tools/list, tools/call)
                          #   GET /sse|/ — SSE transport with /messages?sessionId=
                          #   GET /api/settings — settings JSON
                          #   GET /api/events — EventSource for dashboard
                          #   GET /health — health check
                          # SSE broadcasts on usage/settings events to all clients
                          # 18 cm_* tools: projects CRUD, settings, stats, aggregate, compression,
                          # dashboard, analytics, analyze, search, related, impact, log_event,
                          # read_snippet, search_snippet, cache_get/put, compress_output
        indexer.ts        # walk(), indexProject(), parseFile(), updateFile(), debouncedUpdateFile()
                          # startWatching/stopWatching (fs.watch recursive)
                          # isGeneratedPath, isOversized checks
        auto-register.ts  # ensureProject: sha1[:16] hash → register in registry.sqlite
        db-paths.ts       # getUserDataDir, getRegistryPath, getProjectDbPath (sha1[:16].sqlite)
        db-pool.ts        # LRU cache (max 16) of DatabaseSync instances
        compress.ts       # compressToolOutput (ansi/dedupe/stack/truncate), compressToolOutputSemantic
                          # extractSemanticSummary (test results, grep, glob summaries)
        usage.ts          # logEvent → usage_events table; getUsageSummary
        stats.ts          # getProjectStats, getProjectAggregate, getCompressionStatus,
                          # getDashboardState, getGlobalAnalytics (activity timeline, cumulative savings,
                          # top queries, recent activity, index health, hot files)
        settings.ts       # Settings: 11 booleans + 3 numeric fields, persisted to settings.json
        cache.ts          # In-memory rawCache (200 entries, 5min TTL)
      renderer/
        index.html         # SPA entry
        index.css          # Tailwind + dark theme + scrollbar utilities
        main.tsx           # HashRouter: /, /project/:id, /settings
        App.tsx            # Sidebar + Outlet + ProjectSettingsModal + UpdateModal + mobile drawer
        types.ts           # Project, ProjectSummary, ProjectStats, AggregateData
        lib/
          format.ts        # fmt, fmtK, pct, relTime helpers
        hooks/
          useWebSocket.tsx # EventSource on /api/events → dispatches 'cm-data' CustomEvent
          useUpdateStatus.ts # Subscribes to update:status-changed IPC, exposes check/download/install
        components/
          Sidebar.tsx      # Project list with delete buttons, MCP-connected indicator
          Topbar.tsx       # Sticky header with menu/settings buttons
          ProjectSettingsModal.tsx  # Rename project modal
          UpdateModal.tsx  # Global modal: available/downloading/downloaded/error/unsupported states
          ui.tsx           # Card, EmptyState, Spinner, LoadingScreen
        pages/
          ProjectsPage.tsx     # Global dashboard: HeroMetric, MiniRing, SavingsMechanismChart,
                               # ProjectHealthCard; AreaChart (cumulative savings), BarChart (activity),
                               # BarChart (top queries), PieChart (savings), index health grid
          ProjectDetailPage.tsx # Per-project: hero metrics, savings chart, top files bar chart,
                               # chunk types/languages, index health rings, recent activity
          SettingsPage.tsx     # 11 toggles in 4 categories (intercept, compress, cache, telemetry)
                               # + 3 numeric fields (compress threshold, cache TTL, cache max entries)

  plugin/                 # @codenexum/plugin — thin MCP client (~530 LOC)
    package.json          # Deps: @opencode-ai/plugin ^1.17.18
    src/
      index.ts            # Plugin entry: detects MCP URL from env/file, registers 7 context_* tools,
                          # intercepts read/bash/grep/glob via tool.execute.before/after,
                          # in-memory + persistent cache, loop detection, turn savings tracking,
                          # auto-analyzes on init

  mcp-protocol/           # Referenced in bun.lock but NO source files — placeholder

test/                     # Directory doesn't exist (deleted during v3 refactor)
scripts/
  test-pack.sh            # OLD v2 packaging — references deleted files

docs/
  index.html              # GitHub Pages landing page
  assets/icon.png
  updates.md              # Release & auto-update procedure (GitHub Releases, manual `gh` upload)

.github/workflows/
  ci.yml                  # bun install → typecheck → test
  pages.yml               # Deploy docs/ to GitHub Pages on main
```

---

## Key architecture decisions

- **Plugin is thin** (~530 LOC). All indexing/compression logic lives in the Electron app. Plugin is just an MCP proxy + interception hooks.
- **node:sqlite** (Node 22+ DatabaseSync), NOT better-sqlite3. LRU pool in `db-pool.ts` (max 16 connections).
- **FTS5 with trigram tokenizer** — supports substring search, not just whole-word.
- **MCP transport:** streamable HTTP (JSON-RPC 2.0 + SSE). Also supports custom `/tools/call` for simpler plugin integration.
- **Registry DB** (`registry.sqlite`) maps project paths → per-project DBs (`<sha1[:16]>.sqlite` in `userData/projects/`).
- **Settings** persisted to `userData/settings.json` as JSON.
- **Dashboard** reads via POST /tools/call against the MCP server (same path the plugin uses).
- **SSE keepalive:** 15s ping interval.

---

## MCP tools (18 total in server.ts)

| Tool | Purpose |
|---|---|
| `cm_projects_list` | List all registered projects with chunks/files counts |
| `cm_projects_get` | Get one project by id |
| `cm_projects_delete` | Delete project + its sqlite DB |
| `cm_projects_update` | Rename project |
| `cm_settings_get` / `cm_settings_set` | Read/write Settings |
| `cm_stats` | Per-project index stats + usage summary |
| `cm_aggregate` | byType, byLang, topFiles |
| `cm_compression` | Compression status + semantic saved |
| `cm_dashboard` | Projects list + global totals |
| `cm_analytics` | Activity timeline (24h), cumulative savings, top queries, recent activity, index health, hot files |
| `cm_analyze` | Walk + parse + write to sqlite |
| `cm_search` | FTS5+BM25 search (returns raw results) |
| `cm_related` | Callers/callees/imports/extends/implements via edges table |
| `cm_impact` | Files depending on given files |
| `cm_log_event` | Log usage event to usage_events table |
| `cm_read_snippet` | Return indexed chunk summary for a file (replaces read) |
| `cm_search_snippet` | Compact grep/glob replacement (returns formatted, grouped) |
| `cm_cache_get` / `cm_cache_put` | In-memory rawCache (200 entries, 5min TTL) |
| `cm_compress_output` | ANSI/dedupe/stack + truncate; or semantic if enabled |

Plugin exposes 7 tools to opencode: `context_search`, `context_related`, `context_impact`, `context_stats`, `context_compression`, `context_analyze`, `context_dashboard`. Each maps to an `cm_*` MCP call.

---

## SQLite schema (SCHEMA_VERSION=3)

**Per-project DB:**
- `chunks_fts` — FTS5 virtual table with trigram tokenizer (name, content UNINDEXED; id, file, type, line, lineEnd, body, lang UNINDEXED)
- `file_hashes` — file TEXT PK → sha256 hash, for incremental re-index detection
- `meta` — key/value (schema_version, lastIndexed, projectRoot)
- `edges` — source_file, source_symbol, target_file, target_symbol, kind (import/call/extend/implement/reference); indexes on source + target
- `usage_events` — id, event_type, tokens_saved, tokens_used, meta (JSON), ts

**Registry DB:** `projects` (id PK = sha1[:16], path UNIQUE, name, dbPath, lastSeen). Stale/tmp paths GC'd on list.

---

## Key data flows

1. opencode loads `@codenexum/plugin`. Plugin discovers MCP URL from `CODENEXUM_MCP_URL` env → `~/.config/codenexum/mcp.json` → `http://127.0.0.1:7770`.
2. On `init()`, plugin calls `cm_analyze` for `process.cwd()`.
3. On `tool.execute.before`: plugin records candidates (read → file path, grep/glob → pattern, bash cat/head/tail → file path).
4. On `tool.execute.after`:
   - If candidate → call `cm_read_snippet` or `cm_search_snippet`; if smaller than native, substitute and log `index_substitute` + `file_read`.
   - Else if `autoCompress` and output > `compressThreshold` (8000) and tool is compressible → call `cm_compress_output`; log `compression`.
5. On `session.idle`: flush per-session `turn_savings` to MCP.
6. Electron main registers itself in opencode config, installs plugin dist, cleans old v2 DBs on first launch.

---

## Env vars (from code, not docs)

- `CODENEXUM_MCP_PORT` (7770) — MCP server port
- `CODENEXUM_MCP_URL` — override MCP URL (skips discovery)
- `CODENEXUM_TOKENIZER` (tiktoken) — tokenizer mode
- `CODENEXUM_TOKEN_CACHE_SIZE` (200) — tokenizer LRU size
- `CODENEXUM_SNIPPET_LINES` (12) — default snippet length
- `CODENEXUM_MAX_FILES` (10000) — max files per project
- `CODENEXUM_MAX_FILE_BYTES` (1048576) — 1 MiB max file size
- `CODENEXUM_SMART_READ` — gates ConversationContext
- `CODENEXUM_MAX_LINES_{TOOL}` — per-tool max lines for compression
- `CODENEXUM_UPDATE_FEED_URL` — override update feed URL (testing/staging; `generic` provider)
- `CODENEXUM_DISABLE_UPDATES=1` — force `disabled` updater state even in packaged builds
- `CODENEXUM_UPDATE_CHECK_DELAY_MS` (30000) — delay after `app.whenReady` before first update check

---

## Coding conventions

- **No comments** (ponytail mode). Exceptions: edge cases, deliberate shortcuts marked `// ponytail:`
- TypeScript strict, ESNext, bundler module resolution. All packages are `"type": "module"`.
- Path aliases in root tsconfig: `@codenexum/{core,sql,plugin,electron}` map to `packages/*/src` and `apps/*/src`.
- No explicit `package.json` workspaces field — `bun.lock` serves as the workspace declaration.
- React 19 + Vite for the renderer. Tailwind CSS for styling. Recharts for charts. Lucide React for icons.
- No UI library — hand-rolled Card, EmptyState, Spinner, LoadingScreen in `components/ui.tsx`.
- Dashboard pages use inline HeroMetric, MiniRing, SavingsMechanismChart, ProgressList, ProjectHealthCard.
- `index.css` is just `@tailwind base/components/utilities` + scrollbar utilities + dark theme defaults.
- Electron main process builds to `dist/main/index.cjs` via electron-vite.

---

## Known issues / gotchas

- **Test files deleted** during v3 refactor. `bun test` has nothing to run.
- **`packages/sql/src/types.ts` CODE_EXTS** adds `.xml` and `.txt` compared to `packages/core/src/types.ts`, but no XML parser exists.
- **`packages/sql/src/parsers/`** does NOT include an xml parser despite `.xml` in CODE_EXTS.
- **`mcp-protocol`** workspace referenced in bun.lock has zero source files — placeholder only.
- **`indexer.ts`** uses `@codenexum/core`'s IGNORE/CODE_EXTS for walking; `packages/sql` has slightly different sets for parsing. This is intentional (walk more, parse what's supported).
- **`compressToolOutput`** trimming logic has a bug: method detection uses `preSaved > 0` but never checks if preprocessors actually ran. Combined/truncate may mislabel.
- **`tokenize.py`** exists in root but is not wired to anything.
- **`v2 DB cleanup`** in main process checks `~/.cache/opencode/` for files matching `context-manager-*.sqlite` or `codenexum-*.sqlite`.
- **macOS auto-update is unsigned** (no Apple Developer ID). Every updated .dmg prompts Gatekeeper "Open Anyway" once per build. Win portable users do not auto-update — they get an "unsupported" modal with a link to GitHub Releases.

---

## Build & verify

```bash
bun install                    # workspace install from bun.lock
bun run typecheck              # tsc -b (all packages in tsconfig include)
bun run --filter @codenexum/electron dev       # electron-vite dev
bun run --filter @codenexum/electron package   # electron-builder distributable
bun run --filter @codenexum/plugin build       # tsc for plugin
```

Typecheck covers `packages/*/src/**/*` and `apps/*/src/**/*` per root tsconfig. `dist/` is gitignored.
