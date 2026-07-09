# opencode-context-manager

A search engine for your codebase, built into [opencode](https://opencode.ai).

When you're working on a large project, the AI wastes thousands of tokens reading entire files just to find one function. This plugin fixes that by giving the AI a **local code index** — a searchable database of every function, class, and interface in your project. Instead of reading blindly, the AI searches first, then reads only the 20 lines it actually needs.

**The result:** 90% fewer tokens spent on code lookups, longer productive sessions, and the AI finds things `grep` can't.

## What it does

The plugin runs silently in the background. When opencode starts, it automatically indexes your project — walking every code file, extracting function names, class names, interfaces, types, and enums, and storing them in a local SQLite database with full-text search.

Then, every time the AI needs to find code, it uses `context_search` instead of `grep` + reading whole files. The search returns exact file paths and line numbers in under a millisecond, so the AI reads only what it needs.

When you edit a file, the index updates itself automatically — no manual re-indexing, ever.

## How it saves tokens

Here's what happens when the AI needs to find "the auth handler" in a 679-file project:

**Without this plugin:**
1. The AI runs `grep "auth" src/` — gets back 100+ matches across 56 files (1,800+ tokens of output)
2. The AI reads one full file hoping it's the right one (1,700+ tokens)
3. If `grep` found nothing (the word "auth" doesn't appear literally), the AI lists files with `glob`, then reads them one by one — 3,000+ tokens wasted before it finds anything
4. **Total: 3,500-6,800 tokens per query, and the AI might still get it wrong**

**With this plugin:**
1. The AI calls `context_search "auth handler"` — gets back `function handleAuth @ src/auth.ts:42` in 0.16ms
2. The AI reads 20 lines around line 42
3. **Total: ~430 tokens per query, always finds the right answer**

The difference is even bigger for searches where the keyword doesn't match literally. Searching for `"invoice"` finds `createInvoice`. Searching for `"websocket"` finds `WebSocketHandler`. The trigram tokenizer matches substrings, not just whole words — something `grep` can't do.

## Benchmark

Measured with **tiktoken** (`cl100k_base` — the exact tokenizer used by GPT-4) on real opencode tool output. Project: `madtrackers-sale-point` (679 files, 842 indexed chunks, 273 files with code symbols).

### Token usage per query

| Query | Without plugin | With plugin | Saved |
|-------|---------------:|------------:|------:|
| `auth login handler` | 3,532 | 432 | 87.8% |
| `database connection pool` | 6,887 | 219 | 96.8% |
| `invoice create receipt` | 3,004 | 434 | 85.6% |
| `error handler middleware` | 1,802 | 435 | 75.9% |
| `websocket real-time sync` | 3,004 | 337 | 88.8% |
| **Average** | **3,645** | **371** | **89.8%** |

> `invoice` and `websocket` queries: `grep` returns zero results because those exact words don't appear in the codebase. Without an index, the LLM burns 3,000+ tokens reading files blind. The plugin's trigram tokenizer finds `createInvoice` and `WebSocketHandler` instantly via substring matching.

### Full session (20 turns, 10 code queries)

| Metric | Without plugin | With plugin |
|--------|---------------:|------------:|
| 10 code queries | 36,450 | 3,710 |
| System prompt overhead (20 turns) | 0 | 1,580 |
| Tool definitions (one-time) | 0 | 97 |
| **Session total** | **36,450** | **5,387** |
| **Saved** | — | **31,063 tokens (85.2%)** |

The plugin's overhead is ~1,677 tokens per session. The savings are 31,063 tokens. That's an 18:1 return.

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
  "plugin": ["madkoding-context-manager"]
}
```

**Project-level** (`opencode.json` in your project root):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["madkoding-context-manager"]
}
```

Restart opencode. The plugin auto-indexes your project on first load. No manual setup needed.

### From source (alternative)

If you prefer to run from a local clone:

```bash
git clone https://github.com/madkoding/opencode-context-manager.git
cd opencode-context-manager
./install.sh
```

The installer copies the plugin to `~/.config/opencode/plugins/`, copies the skill to `~/.config/opencode/skills/context-manager/`, installs `@opencode-ai/plugin` via Bun, and adds the plugin to your `opencode.jsonc`.

Install output is newline-delimited JSON on stderr (parseable with `jq`):

```bash
./install.sh 2>&1 | jq -r .message   # human-readable one-liners
./install.sh 2> install.log          # capture to file
```

### Uninstall

**npm:** Remove `"madkoding-context-manager"` from your `plugin` array and restart.

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

Each symbol becomes a "chunk" stored in SQLite: `{ name, file, type, line, content }`. You can also trigger a manual re-index anytime with `context_analyze`, or index a specific path.

### 2. Storage (SQLite FTS5)

The index lives at `~/.cache/opencode/context-manager.sqlite`. Three tables:

- **`chunks_fts`** — an FTS5 virtual table with a `trigram` tokenizer that enables substring matching. The columns `name` and `content` are full-text indexed; `id`, `file`, `type`, and `line` are stored but unindexed (metadata only).
- **`file_hashes`** — MD5 hashes per file, used to skip re-parsing when a file's content hasn't changed.
- **`meta`** — key-value store for `projectRoot` and `indexedAt`.

WAL mode is enabled for concurrent reads during writes. The database connection is opened once at plugin startup and reused for all queries.

### 3. Search (FTS5 + BM25)

When the AI calls `context_search "auth handler"`:

1. The query is tokenized: `"auth" OR "handler"`
2. SQLite FTS5 runs a MATCH query against the inverted index
3. Results are ranked by **BM25** (the standard full-text ranking algorithm)
4. Top N results are returned as `type name @ file:line`

The `trigram` tokenizer is the key to why this works better than `grep`: it breaks text into 3-character sequences, so `"invoice"` matches inside `"createInvoice"`, and `"websocket"` matches inside `"WebSocketHandler"`. `grep` can only match literal strings.

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
Code index available: 842 chunks across 273 files.
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

## Tools

The plugin adds 4 tools that the AI calls directly:

| Tool | Arguments | What it does |
|------|----------|-------------|
| `context_analyze` | `path` (optional) | Re-indexes the project. Runs automatically on first load. Use manually to re-index or target a specific path. |
| `context_search` | `query` (required), `n` (optional, default 10) | Searches the index via FTS5 + BM25. Returns `type name @ file:line` ranked by relevance, with substring matching. |
| `context_stats` | — | Shows what's indexed: project root, timestamp, chunk counts by language, file count. |
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
  @madkoding-context-manager.ts    # Plugin entry point — tool + hook wiring
src/
  types.ts                         # Chunk interface, IGNORE/CODE_EXTS constants
  store.ts                         # SQLite layer (FTS5, CRUD, search, BM25)
  indexer.ts                       # Filesystem walker, project indexer, incremental update
  prompt.ts                        # System prompt builder
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
    index.ts                       # PARSERS map
test/
  parsers.test.ts                  # 36 tests — parser correctness per language
  store.test.ts                    # 18 tests — SQLite CRUD, FTS5, BM25
  indexer.test.ts                  # 13 tests — walk, indexProject, updateFile
  integration.test.ts              # 5 tests — end-to-end index → search → verify
  contracts.test.ts                # 32 tests — interface/output format stability
```

**104 tests, 0 failures.** Run them with `bun test`.

The plugin is fully decoupled: parsers are pure functions, the SQLite layer accepts a `Database` instance as a parameter (no globals), and the indexer accepts a database + filesystem path. The entry point wires everything together with opencode's plugin API.

## Logging

The plugin emits structured logs via `client.app.log()` with `service: "context-manager"`:

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