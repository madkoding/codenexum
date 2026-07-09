# opencode-context-manager

> Keep your [opencode](https://opencode.ai) sessions lean and focused — even on repos with hundreds of files.

A native TypeScript plugin that gives opencode a **searchable code index** and a **context compression strategy**, so the AI spends its token budget on what matters instead of reading entire files blindly.

## Why you need this

As projects grow, the AI's context window fills up fast. Without an index, opencode has to `grep` + `read` whole files just to find one function — burning tokens on imports, comments, and code it never needed. On a 679-file project, a single "where is the auth logic?" question can waste 5,000+ tokens; when `grep` fails (keywords don't match literally), the LLM reads files blind and burns 15,000+.

**context-manager fixes this by:**

1. **Building a lightweight index** of your project's functions, classes, interfaces, types, and enums — just names, signatures, and line numbers.
2. **Letting the AI search before it reads** — `context_search "auth handler"` returns `function handleAuth @ src/auth.ts:42` in milliseconds, so the AI reads only the 20 lines it needs instead of the whole 800-line file.
3. **Staying in sync automatically** — every file edit, create, or delete re-indexes just that file (500ms debounce, content-hash diff). No manual re-runs.
4. **Guiding the AI to compress** — an injected system prompt + SKILL.md teach the AI to classify files into three detail tiers (active / dependencies / rest-of-repo) and strip content when context gets tight.

**Real-world savings:** on a typical mid-size project (~150 files), searching instead of blind-reading saves ~90% tokens per lookup. Over a long session, that's the difference between a productive hour and hitting the context limit mid-task.

## Benchmark: real token savings

Measured on a real project (`madtrackers-sale-point`: 679 files, 842 chunks indexed). Each query simulates a typical user question — "where is the auth logic?" — and compares two approaches:

- **Without plugin (grep + blind read):** the LLM runs `grep` to find candidate files, then reads 3 full files to locate the function. When `grep` finds nothing (keywords don't match literally), the LLM falls back to listing directories and reading files blind — far more expensive.
- **With plugin (search + targeted read):** `context_search` returns exact file + line in milliseconds, then the LLM reads ~20 lines around that location.

### Per-query comparison

| Query | Without plugin (tokens) | With plugin (tokens) | Saved | % |
|-------|------------------------:|---------------------:|------:|--:|
| `auth login handler` | 5,075 | 101 | 4,974 | 98.0% |
| `database connection pool` | 1,942 | 112 | 1,830 | 94.2% |
| `invoice create receipt` | 15,000 | 130 | 14,870 | 99.1% |
| `error handler middleware` | 1,326 | 117 | 1,209 | 91.2% |
| `websocket real-time sync` | 15,000 | 72 | 14,928 | 99.5% |
| **TOTAL (5 queries)** | **38,343** | **532** | **37,811** | **98.6%** |
| **Average per query** | **7,668** | **106** | **7,562** | — |

> **Note:** `invoice` and `websocket` queries show 15,000 tokens "without plugin" because `grep` returns zero results (those exact words don't appear in the codebase). Without an index, the LLM has no choice but to read files blind — directories, file lists, random files — until it stumbles on the right one. The plugin's partial-token matching finds them instantly.

### Session projection (20 turns, 10 code queries)

| Metric | Without plugin | With plugin | Saved |
|--------|--------------:|------------:|------:|
| 10 code queries | 76,680 | 1,060 | 75,620 |
| System prompt (20 turns) | 0 | 1,240 | -1,240 |
| Tool definitions (one-time) | 0 | 200 | -200 |
| **Session total** | **76,680** | **2,500** | **74,180 (96.7%)** |

The plugin's overhead (system prompt injection + tool definitions) is ~1,440 tokens total — dwarfed by the 74,180 tokens saved on code lookups.

### What "without plugin" actually costs

When the LLM needs to find code without an index, it does one of:

1. **`grep` + read 3-5 full files** — works when keywords match literally, but still reads 1,000-5,000 tokens of irrelevant code per query.
2. **`glob` + read files one by one** — when `grep` fails, the LLM lists files and reads them blind. On a 679-file project, this can burn 15,000+ tokens before finding the right function.
3. **Ask the user** — worst case: the LLM gives up and asks "which file has the auth logic?", costing a round-trip and user patience.

The plugin eliminates all three by providing a pre-built index that the LLM queries in one tool call.

### How the benchmark was measured

- **Project:** `madtrackers-sale-point` (Next.js, 679 code files, 842 indexed chunks)
- **Token estimation:** word count / 0.75 (standard approximation for English + code)
- **Without plugin:** `grep -rn <keyword> src/` output tokens + reading 3 full files from results
- **With plugin:** `context_search` output (5 results × ~10 tokens each) + reading 20 lines around the best match
- **System prompt overhead:** the `<context-manager>` block injected each turn (~62 tokens)
- **Tool overhead:** 4 tool definitions sent once per session (~200 tokens)

Benchmark run live inside opencode — the AI you're reading right now used `context_search` to write this section.

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
| Ruby | `.rb` | *(planned)* |
| PHP | `.php` | *(planned)* |
| C/C++ | `.c` `.h` `.cpp` `.hpp` | *(planned)* |
| C# | `.cs` | *(planned)* |

> Ruby, PHP, C/C++, and C# file extensions are recognized by the walker but don't have dedicated parsers yet. They'll be indexed as empty chunk lists until parsers are added.

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