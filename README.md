# opencode-context-manager

A search engine for your codebase, built into [opencode](https://opencode.ai).

When you're working on a large project, the AI wastes thousands of tokens reading entire files just to find one function. This plugin fixes that by giving the AI a **local code index** — a searchable database of every function, class, and interface in your project. Instead of reading blindly, the AI searches first, then reads only the 20 lines it actually needs.

**The result:** 90% fewer tokens spent on code lookups, longer productive sessions, and the AI finds things `grep` can't.

## What it does

The plugin runs silently in the background. When opencode starts, it automatically indexes your project — walking every code file, extracting function names, class names, interfaces, types, and enums, and storing them in a local SQLite database with full-text search.

Then, every time the AI needs to find code, it uses `context_search` instead of `grep` + reading whole files. The search returns exact file paths and line numbers in under a millisecond, so the AI reads only what it needs.

When you edit a file, the index updates itself automatically — no manual re-indexing, ever.

## How it saves tokens

Here's what happens when the AI needs to find `authenticate()` in a 16-file project:

**Without this plugin:**
1. The AI runs `grep "authenticate" src/` — gets back matches across multiple files (hundreds of tokens)
2. The AI reads one full file hoping it's the right one (1,000+ tokens)
3. If the name doesn't match literally, the AI lists files with `glob`, then reads them one by one — 2,000+ tokens wasted
4. **Total: 2,052 tokens per query**

**With this plugin:**
1. The AI calls `context_search "authenticate"` — gets back `function authenticate @ src/auth/auth.ts:4` in 0.16ms
2. The AI reads auth.ts (1,117 chars)
3. **Total: 320 tokens per query, always finds the right answer**

The difference is even bigger for searches where the keyword doesn't match literally. Searching for `"invoice"` finds `createInvoice`. Searching for `"websocket"` finds `WebSocketHandler`. The trigram tokenizer matches substrings, not just whole words — something `grep` can't do.

## Tokenizer

The plugin measures token counts with `gpt-tokenizer` (cl100k_base) when it is available in the runtime environment. This gives counts close to what GPT-4/GPT-4o/Claude 3 actually see. If `gpt-tokenizer` is not installed, it falls back silently to a fast `~4 chars/token` heuristic.

No npm dependency is declared for `gpt-tokenizer` so the plugin stays self-contained when installed through opencode's shim. To get exact counts, install it in the environment where opencode runs (e.g. `bun add gpt-tokenizer`).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CONTEXT_MANAGER_TOKENIZER` | `tiktoken` | `tiktoken` (exact) or `estimate` (4 chars/token). |
| `CONTEXT_MANAGER_TOKEN_CACHE_SIZE` | `200` | LRU cache size for real token counts. |
| `CONTEXT_MANAGER_SNIPPET_LINES` | `12` | Lines per search snippet. |
| `CONTEXT_MANAGER_INTERCEPT_MODE` | `substitute` | `off`, `warn`, or `substitute`. Replaces native `read`/`grep`/`glob`/`bash` outputs with index snippets. |
| `CONTEXT_MANAGER_INTERCEPT_BASH` | `1` | Intercept simple `bash` commands. Set to `0` to disable. |
| `CONTEXT_MANAGER_TOOL_MAX_LINES_READ` | `25` | Max lines kept from a `read` output. |
| `CONTEXT_MANAGER_TOOL_MAX_LINES_BASH` | `30` | Max lines kept from a `bash` output. |
| `CONTEXT_MANAGER_TOOL_MAX_LINES_GREP` | `25` | Max lines kept from a `grep` output. |
| `CONTEXT_MANAGER_TOOL_MAX_LINES_GLOB` | `50` | Max lines kept from a `glob` output. |
| `CONTEXT_MANAGER_TOOL_MAX_LINES` | — | Legacy fallback for all tools. |
| `CONTEXT_MANAGER_SEMANTIC_COMPRESS` | `1` | Summarize test/linter/install/build outputs. |
| `CONTEXT_MANAGER_GROUP_RESULTS` | `1` | Group `context_search` results by file when 5+. |
| `CONTEXT_MANAGER_VERBOSE_PROMPT` | `0` | Include full top/hot files in the system prompt. |
| `CONTEXT_MANAGER_COMPACT_AT` | `0.6` | Context fill ratio to start compacting old tool outputs. |
| `CONTEXT_MANAGER_COMPACT_MIN_CHARS` | `400` | Min output size to compact. |
| `CONTEXT_MANAGER_CACHE_TOOLS` | `1` | Cache recent tool outputs answered from the index. |
| `CONTEXT_MANAGER_SMART_READ` | `0` | Only return chunks relevant to the conversation (experimental). |
| `CONTEXT_MANAGER_INCLUDE_COMMENTS` | `1` | Include comments/docstrings in snippets. Set to `0` to strip. |
| `CONTEXT_MANAGER_COMPRESS_WRITES` | `0` | Instruct the model to wrap large writes in gzip+base64 markers (experimental). |
| `CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD` | `1000` | Min characters in a write before using the compression markers. |
| `CONTEXT_MANAGER_COMPRESS_OUTPUT` | `0` | Compress long assistant responses and user messages in the conversation history using gzip+base64 markers. |
| `CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD` | `500` | Min characters in a message before compressing it in the history. |

## Generative write compression

When `CONTEXT_MANAGER_COMPRESS_WRITES=1`, the system prompt tells the model to emit files of `CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD`+ characters as:

```
--- compressed:<relative file path> ---
<gzip-compressed content as base64>
--- end compressed ---
```

The plugin transparently decompresses the content before it reaches the filesystem via the `experimental.chat.messages.transform` hook, reducing the model's output tokens for large file writes. The dashboard tracks `generativeCompression` as a separate savings mechanism.

## Tool interception

By default the plugin intercepts `read`, `grep`, `glob`, and one-shot `bash` commands (`cat`, `head`, `tail`, `grep`, `rg`, `find`, `fd`, `git grep`) and replaces their output with a compact result from the local code index. This is **post-execution substitution**: the native tool still runs, but the AI receives the indexed snippet instead of the raw full output, saving context tokens.

Complex commands (pipes, redirecciones, subshells) are never intercepted. Set `CONTEXT_MANAGER_INTERCEPT_MODE=off` to disable interception globally, or `=warn` to only log opportunities without replacing output.

### Context token savings

The plugin saves context tokens through several mechanisms:

1. **Index substitution** — replaces full file reads with compact snippets.
2. **Snippet length** — search results default to 12 lines instead of 20.
3. **Per-tool truncation** — `read`/`grep` outputs are capped to 25 lines, `bash` to 30.
4. **Semantic compression** — test runners, linters, installers and build tools are summarized.
5. **Result grouping** — search results from the same file are grouped under one header.
6. **History compaction** — old tool outputs are replaced with references to the index when context is tight.
7. **Tool output cache** — repeated reads of unchanged files reuse the compact snippet.
8. **Smart read** (disabled by default) — only returns chunks related to the current question.
9. **Strip comments** (disabled by default) — removes comments/docstrings from snippets.
10. **Generative write compression** (disabled by default) — large writes are wrapped in gzip+base64 markers by the model and decompressed transparently.
11. **Bidirectional output compression** (disabled by default) — long assistant responses and user messages are compressed in the conversation history using gzip+base64 markers, saving input tokens on subsequent turns.

## Benchmark

Measured with the active tokenizer (defaults to tiktoken real counts when available) on a synthetic 16-file project (74 indexed chunks, 8,207 source chars).

### Token usage per query

| Query | Without plugin | With plugin | Saved |
|-------|---------------:|------------:|------:|
| `authenticate login` | 2,052 | 320 | 84.4% |
| **Average** | **2,052** | **320** | **84.4%** |

The index compresses the full codebase to **34% of its original size** (2,052 → 699 tokens). For a targeted lookup, the AI reads 1 file instead of 16 — saving 1,732 tokens per query.

### Search engine speed

| | Previous (JSON) | Current (SQLite FTS5) | Speedup |
|--|----------------:|----------------------:|--------:|
| Average query time | 2.16ms | 0.16ms | **14x** |

The JSON approach re-tokenized all 842 chunks on every search. SQLite FTS5 uses an inverted index with constant-time lookup — it stays fast as your project grows.

## Installation

### From npm (recommended)

Add the package name to your opencode config file. That's it — opencode installs the plugin automatically via Bun on startup.

**Global** (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@madtech/opencode-context-manager-plugin"]
}
```

**Project-level** (`opencode.json` in your project root):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@madtech/opencode-context-manager-plugin"]
}
```

The `npm install` postinstall hook automatically copies a small `context-manager-loading-shim.ts` to `~/.config/opencode/plugins/`. That shim loads instantly on every opencode startup and shows an "Installing plugin…" toast while the main npm plugin is downloading. After the first install, both the shim and the npm cache are warm, and startups are fast.

Restart opencode. The plugin auto-indexes your project in a background worker (does not block the TUI) and copies the bundled `SKILL.md` to `~/.config/opencode/skills/context-manager/` so opencode discovers it without extra config. No manual setup needed.

> **Note:** The first opencode startup after adding the plugin will appear frozen for ~30 seconds while opencode downloads the package via Bun. This is normal — subsequent startups use the cache and are instant.

If you open opencode in a very large directory (e.g. your home), the auto-index is capped at 10,000 files. Pass a narrower path to `context_analyze` for full coverage, or raise the cap with `CONTEXT_MANAGER_MAX_FILES=50000`.

### From source (alternative)

If you prefer to run from a local clone (useful for development or if you don't have npm):

```bash
git clone https://github.com/madkoding/opencode-context-manager.git
cd opencode-context-manager
./install.sh
```

The installer copies the plugin and the shim to `~/.config/opencode/plugins/`, installs `@opencode-ai/plugin` via Bun, and adds the plugin to your `opencode.jsonc`. The skill is copied on first plugin load.

Install output is newline-delimited JSON on stderr (parseable with `jq`):

```bash
./install.sh 2>&1 | jq -r .message   # human-readable one-liners
./install.sh 2> install.log          # capture to file
```

### Upgrading

Just run `npm install -g @madtech/opencode-context-manager-plugin@latest` (or `npm update -g`). The postinstall hook compares the bundled shim with the one in `~/.config/opencode/plugins/` and overwrites it only if the version changed. Opencode picks up the new shim on the next startup.

### Uninstall

**npm:** Remove `"@madtech/opencode-context-manager-plugin"` from your `plugin` array and restart. The plugin and the shim are both self-cleaning:

- The shim checks the config on every opencode startup. If the plugin is no longer in the config, the shim self-deletes from `~/.config/opencode/plugins/`.
- The main plugin also checks the config in `ensureShimInstalled` and removes the shim if the plugin was uninstalled.

For a thorough manual cleanup:

```bash
rm ~/.config/opencode/plugins/context-manager-loading-shim.ts
rm -rf ~/.cache/opencode/packages/@madtech
rm -rf ~/.cache/opencode/context-manager.sqlite*
rm -rf ~/.config/opencode/skills/context-manager
```

**Source:** Run `./uninstall.sh` from the cloned repo.

## How it works

### 1. Indexing (automatic)

When opencode starts and no index exists, the plugin automatically walks your project directory — skipping `node_modules/`, `.git/`, `dist/`, `build/`, and other common ignore targets. For every code file it finds, it uses language-specific regex patterns to extract:

- Functions and methods (including arrow functions in JS/TS)
- Classes and structs
- Interfaces
- Type aliases
- Enums
- Traits (Rust), modules (Ruby), namespaces (C++)

Each symbol becomes a "chunk" stored in SQLite: `{ name, file, type, line, lineEnd, content, body, lang }`. Auto-indexing runs in a background worker on first load and never blocks the TUI. The walk is capped at 10,000 files (override with `CONTEXT_MANAGER_MAX_FILES`). You can also trigger a manual re-index anytime with `context_analyze`, or index a specific path.

The indexer also builds a lightweight **1-level relationship graph**: imports, function calls, class extends, and interface implements. This enables `context_related` and `context_impact` without the weight of a full code graph.

### 2. Storage (SQLite FTS5)

The index lives at `~/.cache/opencode/context-manager.sqlite`. Four tables:

- **`chunks_fts`** — an FTS5 virtual table with a `trigram` tokenizer that enables substring matching. The columns `name` and `content` are full-text indexed; `id`, `file`, `type`, `line`, `lineEnd`, `body`, and `lang` are stored but unindexed (metadata only).
- **`file_hashes`** — MD5 hashes per file, used to skip re-parsing when a file's content hasn't changed.
- **`meta`** — key-value store for `projectRoot`, `indexedAt`, and `schema_version`.
- **`edges`** — lightweight 1-level relations: `import`, `call`, `extend`, `implement`.

WAL mode is enabled for concurrent reads during writes. The database connection is opened once at plugin startup and reused for all queries.

### 3. Search (FTS5 + BM25)

When the AI calls `context_search "auth handler"`:

1. The query is tokenized: `"auth" OR "handler"`
2. SQLite FTS5 runs a MATCH query against the inverted index
3. Results are ranked by **BM25** (the standard full-text ranking algorithm)
4. Top N results are returned as `type name @ file:line`

The `trigram` tokenizer is the key to why this works better than `grep`: it breaks text into 3-character sequences, so `"invoice"` matches inside `"createInvoice"`, and `"websocket"` matches inside `"WebSocketHandler"`. `grep` can only match literal strings.

### 3b. Related symbols and impact

Two extra tools leverage the 1-level relation graph:

- `context_related src/auth.ts:authenticate` — shows callers, callees, imports, extends, and implements for that symbol.
- `context_impact ["src/auth.ts"]` — shows files/symbols that depend on the given files, useful before making a change.

These are **heuristic, not a full code graph** (that would require tree-sitter). They are accurate for direct local imports and explicit function calls, which covers the most common agent questions.

### 4. Auto-update (incremental)

When you edit, create, or delete a file, the `event` hook fires:

1. **500ms debounce** — coalesces rapid save bursts
2. **MD5 hash check** — if the file content hasn't changed, skip entirely
3. **Incremental update** — delete old chunks for that file (`DELETE FROM chunks_fts WHERE file = ?`), parse the new content, insert the new chunks

Deleted files have their chunks and hash removed. The index is always current — you never need to re-run `context_analyze` after the initial auto-index.

### 5. System prompt injection

Each chat turn, the `experimental.chat.system.transform` hook checks if an index exists. If so, it injects a block into the system prompt:

```
<context-manager>
Code index available: 74 chunks across 16 files.
Indexed: 2026-07-09T03:39:54Z

IMPORTANT: Use the context_search tool to find code locations BEFORE reading files.
This saves tokens — search returns function/class names with line numbers,
so you can read only the specific file and section you need.
</context-manager>
```

This nudges the AI toward search-first behavior without forcing it.

### 6. Context compression (via SKILL.md)

The bundled skill teaches opencode to classify files into three tiers when context is limited:

| Tier | What the AI keeps | When it applies |
|------|-------------------|-----------------|
| Active files | Full content | Files the user is editing or discussing |
| Dependencies | Signatures + types only | Imported/required files |
| Rest of repo | One-line summary | Everything else |

Token budget: 50% active files / 30% dependency signatures / 20% search results + summaries.

### 7. Web dashboard (localhost)

Run `context_dashboard` to open a local web dashboard at `http://127.0.0.1:3567`. It visualizes what the plugin is doing in real time:

| Section | What it shows |
|---|---|
| Hero metrics | Estimated tokens saved, searches, snippet-only answers, files read, compactations. |
| Index status | Chunks, files, edges, languages, last indexed time. |
| Context pressure | Fill ratio with a live progress bar. |
| Hot files | Files with the most dependents — warns before editing. |
| Project map | Top files by symbol count. |
| Recent searches | Last 20 queries and whether they were answered from snippets. |
| Recent index activity | Files re-indexed by auto-update. |

The dashboard is **localhost-only** (127.0.0.1) and refreshes every 3 seconds.

## Tools

The plugin adds 5 tools that the AI calls directly:

| Tool | Arguments | What it does |
|------|----------|-------------|
| `context_analyze` | `path` (optional) | Re-indexes the project. Runs automatically on first load. Use manually to re-index or target a specific path. |
| `context_search` | `query` (required), `n` (optional, default 10) | Searches the index via FTS5 + BM25. Returns `type name @ file:line` ranked by relevance, with substring matching. |
| `context_related` | `symbol` (required), `n` (optional) | Callers, callees, imports, extends, implements for a symbol. |
| `context_impact` | `files` (required), `n` (optional) | Files/symbols that depend on the given files. |
| `context_stats` | — | Shows what's indexed, context fill, searches, and estimated token savings. |
| `context_dashboard` | — | Opens the local web dashboard. |
| `context_clear` | — | Deletes the entire index. Use when switching projects or starting fresh. |

## Supported languages

| Language | Extensions | What it extracts |
|----------|-----------|------------------|
| Python | `.py` | functions, classes |
| JavaScript / TypeScript | `.js` `.jsx` `.ts` `.tsx` | functions, arrow functions, classes, interfaces, types, enums |
| Go | `.go` | functions, structs, interfaces |
| Rust | `.rs` | functions, structs, enums, traits |
| Java | `.java` | classes, methods, interfaces, enums |
| Ruby | `.rb` | functions, classes, modules |
| PHP | `.php` | functions, classes, interfaces, traits, enums |
| C / C++ | `.c` `.h` `.cpp` `.hpp` | functions, classes, structs, namespaces, enums |
| C# | `.cs` | methods, classes, interfaces, structs, enums |

## Architecture

```
plugins/
  @madtech-opencode-context-manager-plugin.ts    # Plugin entry point — tool + hook wiring
  context-manager-loading-shim.ts                # Local shim — instant-load toast during npm install
  worker-indexer.ts                              # Background worker for the auto-index
src/
  types.ts                         # Chunk interface, IGNORE/CODE_EXTS constants
  store.ts                         # SQLite layer (FTS5, CRUD, search, BM25)
  indexer.ts                       # Filesystem walker, project indexer, incremental update
  prompt.ts                        # System prompt builder
  budget.ts                        # Token usage tracking + savings estimation
  compact.ts                       # History compaction
  compress.ts                      # Tool output compression
  dashboard.ts                     # Localhost web dashboard
  edges.ts                         # Relationship extraction
  resolve.ts                       # Symbol reference parser
  search.ts                        # Filtered search
  format.ts                        # Result formatting
  parsers/
    python.ts                      # pyParse
    javascript.ts                  # jsParse, tsParse
    go.ts                          # goParse
    rust.ts                        # rsParse
    java.ts                        # javaParse
    ruby.ts                        # rbParse
    php.ts                         # phpParse
    cpp.ts                         # cppParse (C + C++)
    csharp.ts                      # csParse
    formats.ts                     # cssParse, htmlParse, dataParse, sqlParse, mdParse
    index.ts                       # PARSERS map
skills/
  context-manager/SKILL.md         # Bundled skill (auto-copied to ~/.config/opencode/skills/)
scripts/
  postinstall.sh                   # Runs on npm install — drops the shim into the global plugins dir
test/
  parsers.test.ts                  # Parser correctness per language
  store.test.ts                    # SQLite CRUD, FTS5, BM25
  indexer.test.ts                  # walk, indexProject, updateFile
  integration.test.ts              # End-to-end index → search → verify
  contracts.test.ts                # Interface/output format stability
```

**171+ tests, 0 failures.** Run them with `bun test`.

The plugin is fully decoupled: parsers are pure functions, the SQLite layer accepts a `Database` instance as a parameter (no globals), and the indexer accepts a database + filesystem path. The entry point wires everything together with opencode's plugin API.

## Logging

The plugin emits structured logs via `client.app.log()` with `service: "opencode-context-manager-plugin"` (and `service: "context-manager-shim"` for the shim):

| Level | When it fires |
|-------|---------------|
| `info` | Plugin initialized, project indexed, auto-analyze complete |
| `debug` | File re-indexed, file removed from index |
| `warn` | File read failed (permissions, missing) |

Install/uninstall scripts emit newline-delimited JSON to stderr for programmatic consumption.

## Requirements

- **opencode >=1.0.0** — declared in `package.json` under `engines.opencode`. Enforced on npm install; serves as documentation for local installs.
- **[Bun](https://bun.sh)** — only needed for local-file installs. npm installs are handled by opencode's built-in Bun integration. SQLite is built into Bun (`bun:sqlite`) — zero additional dependencies.

## License

MIT