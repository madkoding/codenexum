# opencode-context-manager

> Keep your [opencode](https://opencode.ai) sessions lean and focused — even on repos with hundreds of files.

A native TypeScript plugin that gives opencode a **searchable code index** and a **context compression strategy**, so the AI spends its token budget on what matters instead of reading entire files blindly.

## Why you need this

As projects grow, the AI's context window fills up fast. Without an index, opencode has to `grep` + `read` whole files just to find one function — burning tokens on imports, comments, and code it never needed. On a 679-file project, a single "where is the auth logic?" question wastes 3,500+ tokens; when `grep` fails (keywords don't match literally), the LLM falls back to `glob` + blind reads, burning 3,000+ more.

**context-manager fixes this by:**

1. **Building a lightweight index** of your project's functions, classes, interfaces, types, and enums — just names, signatures, and line numbers.
2. **Letting the AI search before it reads** — `context_search "auth handler"` returns `function handleAuth @ src/auth.ts:42` in milliseconds, so the AI reads only the 20 lines it needs instead of the whole 800-line file.
3. **Staying in sync automatically** — every file edit, create, or delete re-indexes just that file (500ms debounce, content-hash diff). No manual re-runs.
4. **Guiding the AI to compress** — an injected system prompt + SKILL.md teach the AI to classify files into three detail tiers (active / dependencies / rest-of-repo) and strip content when context gets tight.

**Measured savings:** 86.5% average token reduction per query on a real 679-file project (tiktoken-verified, see benchmark below).

## Benchmark: real token savings

Measured with **tiktoken** (`cl100k_base` — the tokenizer used by GPT-4/Claude-class models) on real opencode tool output. Project: `madtrackers-sale-point` (679 files, 842 chunks indexed). Each query simulates a typical user question and compares two approaches:

- **Without plugin:** the LLM runs `grep` to find candidate files, then reads 1 full file. When `grep` returns nothing (keywords don't match literally), the LLM falls back to `glob` + 3 blind file reads — modeled here because that's what actually happens.
- **With plugin:** `context_search` returns exact file + line, then the LLM reads ~20 lines around that location.

### Per-query comparison

| Query | Without plugin (tokens) | With plugin (tokens) | Saved | % |
|-------|------------------------:|---------------------:|------:|--:|
| `auth login handler` | 3,532 | 531 | 3,001 | 85.0% |
| `database connection pool` | 6,887 | 453 | 6,434 | 93.4% |
| `invoice create receipt` | 3,004 | 669 | 2,335 | 77.7% |
| `error handler middleware` | 1,802 | 480 | 1,322 | 73.4% |
| `websocket real-time sync` | 3,004 | 337 | 2,667 | 88.8% |
| **TOTAL (5 queries)** | **18,229** | **2,470** | **15,759** | **86.5%** |
| **Average per query** | **3,645** | **494** | **3,151** | — |

> **Note:** `invoice` and `websocket` queries: `grep` returns zero results (those exact words don't appear in the codebase). Without an index, the LLM runs `glob` (1,088 tokens of file listing) then reads 3 files blind (1,912 tokens) before finding anything — or gives up and asks the user. The plugin's partial-token matching finds the right function in one call.

### Session projection (20 turns, 10 code queries)

| Metric | Without plugin | With plugin | Saved |
|--------|--------------:|------------:|------:|
| 10 code queries | 36,450 | 4,940 | 31,510 |
| System prompt (20 turns) | 0 | 1,580 | -1,580 |
| Tool definitions (one-time) | 0 | 100 | -100 |
| **Session total** | **36,450** | **6,620** | **29,830 (81.8%)** |

The plugin's overhead (system prompt injection + tool definitions) is ~1,680 tokens per session — dwarfed by the 29,830 tokens saved on code lookups.

### What "without plugin" actually costs

When the LLM needs to find code without an index, it does one of:

1. **`grep` + read 1-3 full files** — works when keywords match literally, but still reads 1,700-6,800 tokens of irrelevant code per query.
2. **`glob` + read files blind** — when `grep` fails, the LLM lists files (1,088 tokens) and reads them one by one. On a 679-file project, this burns 3,000+ tokens before finding the right function — or the LLM gives up.
3. **Ask the user** — worst case: the LLM asks "which file has the auth logic?", costing a round-trip and user patience.

The plugin eliminates all three by providing a pre-built index that the LLM queries in one tool call.

### How the benchmark was measured

- **Tokenizer:** tiktoken `cl100k_base` (exact tokenizer used by GPT-4, not an approximation)
- **Project:** `madtrackers-sale-point` (Next.js, 679 code files, 842 indexed chunks)
- **Without plugin:** `grep -rn <keyword> src/` output + reading 1 full file from results. When grep returns nothing: `glob` output + 3 blind file reads (realistic fallback behavior)
- **With plugin:** `context_search` output (5 results) + reading 20 lines around the best match
- **System prompt overhead:** the `<context-manager>` block injected each turn (79 tokens)
- **Tool overhead:** 4 tool definitions sent once per session (100 tokens)

## What's included

- **4 custom tools** the LLM calls directly:
  - `context_analyze` — indexes a project: walks code files, extracts symbols, stores in a local JSON index
  - `context_search` — keyword/phrase search over the index; returns type, name, file, and line number
  - `context_stats` — shows what's indexed (chunk counts by language, file counts, timestamp)
  - `context_clear` — wipes the index (useful when switching projects)
- **2 hooks** that run automatically:
  - `event` hook — listens for `file.edited` / `file.watcher.updated` and re-indexes only the changed file (debounced + hash-diffed)
  - `experimental.chat.system.transform` hook — injects a `<context-manager>` system-prompt block each turn, reminding the AI to search before reading
- **SKILL.md** — teaches opencode a three-tier compression strategy (active files / dependencies / rest-of-repo) and a token budget heuristic

No Python, no venv, no native modules. One runtime dependency: `@opencode-ai/plugin` (installed automatically by Bun or npm).

## Installation

You can install this plugin **two ways**, both fully supported.

### Option A — From npm (recommended)

Add the package name to your opencode config. Opencode installs it automatically via Bun at startup.

`~/.config/opencode/opencode.json` (global) or `opencode.json` (project-level):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["madkoding-context-manager"]
}
```

Restart opencode. The plugin loads from `~/.cache/opencode/node_modules/`, and `engines.opencode: ">=1.0.0"` is validated on load. No manual file copying needed.

> **Note:** The `engines.opencode` field in `package.json` is only enforced for npm-installed plugins. If you install from local files (Option B), it serves as documentation.

### Option B — From local files

Clone the repo and run the installer, which copies the plugin + skill and updates your config.

```bash
git clone https://github.com/madkoding/opencode-context-manager.git
cd opencode-context-manager
./install.sh
# Restart opencode
```

The script:
1. Copies the plugin to `~/.config/opencode/plugins/`
2. Copies `SKILL.md` to `~/.config/opencode/skills/context-manager/`
3. Installs `@opencode-ai/plugin` via Bun if not already present
4. Adds `"./plugins/@madkoding-context-manager.ts"` to the `plugin` array in `opencode.jsonc`

Install output is newline-delimited JSON on stderr (parseable with `jq`):

```bash
./install.sh 2> install.log          # capture to file
./install.sh 2>&1 | jq -r .message   # human-readable one-liners
```

### Uninstallation

**npm:** Remove `"madkoding-context-manager"` from your `plugin` array and restart.

**Local:**

```bash
./uninstall.sh
```

Both install and uninstall emit structured JSON logs to stderr (`service: "context-manager.install"` / `"context-manager.uninstall"`).

## Tools reference

| Tool | Args | What it does |
|------|------|--------------|
| `context_analyze` | `path` (optional, defaults to session dir) | Walks the project, parses all code files, builds the index. Run once per project — auto-updates handle the rest. |
| `context_search` | `query` (required), `n` (optional, default 10) | Keyword/phrase search. Returns `type name @ file:line` ranked by relevance (name matches score 5x, content matches 2x, partial matches 1x). |
| `context_stats` | — | Shows index metadata: project root, indexed-at timestamp, chunk counts by file extension, total file count. |
| `context_clear` | — | Deletes the index JSON. Use when switching to a different project or starting fresh. |

## How it works

### Indexing

`context_analyze` walks the directory tree (skipping `node_modules/`, `.git/`, `dist/`, `build/`, etc.) and for each code file extracts:

- **Functions** (including arrow functions in JS/TS)
- **Classes** and **structs** (Go/Rust)
- **Interfaces** (TS, Go, Java)
- **Type aliases** (TS)
- **Enums** (TS, Rust, Java)
- **Traits** (Rust, mapped to interface)

Extraction uses language-specific regex patterns — fast, zero-dependency, no AST parser overhead. Each symbol becomes a "chunk" with `{ id, file, name, type, line, content }`.

### Storage

The index lives at `~/.cache/opencode/context-manager.json` — a single JSON file with `{ projectRoot, chunks[], indexedAt, fileHashes }`. No database, no server, no lock files.

### Search scoring

`context_search` tokenizes the query and each chunk's name + content, then scores:

| Match type | Score |
|------------|-------|
| Exact token match in **name** | ×5 |
| Exact token match in **content** | ×2 |
| Partial token match (≥3 chars) in **name** | ×2 |
| Partial token match (≥3 chars) in **content** | ×1 |

Results are sorted by score, truncated to `n` (default 10).

### Auto-update

When a file is edited, created, or deleted, the `event` hook fires:

1. **Debounce** (500ms) — coalesce rapid save bursts
2. **Hash check** (MD5 of file content) — skip re-parse if content unchanged
3. **Remove** old chunks for that file, **parse** new content, **save** updated index

Deleted files (`unlink` event) have their chunks removed. This means your index is always current without ever re-running `context_analyze` manually.

### System prompt injection

Each chat turn, the `experimental.chat.system.transform` hook checks if an index exists. If so, it injects:

```
<context-manager>
Code index available: 142 chunks across 23 files.
Indexed: 2026-07-08T22:00:00.000Z

IMPORTANT: Use the context_search tool to find code locations BEFORE reading files.
This saves tokens — search returns function/class names with line numbers,
so you can read only the specific file and section you need.
</context-manager>
```

This nudges the AI toward search-first behavior without forcing it.

### Compression strategy (via SKILL.md)

The bundled skill teaches opencode to classify files into three tiers when context is limited:

| Tier | Detail level | When to apply |
|------|-------------|---------------|
| **Active** | Full content | Files the user is actively editing or discussing |
| **Dependencies** | Signatures + types only | Imported/required files |
| **Rest of repo** | One-line summary | Everything else, unless explicitly asked |

Token budget heuristic: 50% active / 30% dependency signatures / 20% search results + summaries.

## Supported languages

| Language | Extensions | Symbols extracted |
|----------|-----------|-------------------|
| Python | `.py` | functions, classes |
| JavaScript / TypeScript | `.js` `.jsx` `.ts` `.tsx` | functions, arrow functions, classes, interfaces, types, enums |
| Go | `.go` | functions, structs, interfaces |
| Rust | `.rs` | functions, structs, enums, traits |
| Java | `.java` | classes, methods, interfaces, enums |
| Ruby | `.rb` | functions, classes, modules |
| PHP | `.php` | functions, classes, interfaces, traits, enums |
| C/C++ | `.c` `.h` `.cpp` `.hpp` | functions, classes, structs, namespaces, enums |
| C# | `.cs` | methods, classes, interfaces, structs, enums |

## Logging

The plugin emits structured logs via `client.app.log()` with `service: "context-manager"`:

| Level | When |
|-------|------|
| `info` | Plugin initialized, project indexed |
| `debug` | File re-indexed, file removed from index |
| `warn` | File read failed (permissions, missing) |
| `error` | *(reserved for future use)* |

Install/uninstall scripts emit newline-delimited JSON to stderr for programmatic consumption.

## Requirements

- **opencode >=1.0.0** (declared in `package.json` `engines.opencode`; enforced on npm install, documented for local install)
- **[Bun](https://bun.sh)** — only needed for local-file installs; npm installs are handled by opencode's built-in Bun integration

## License

MIT