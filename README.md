# opencode-context-manager

A plugin for [opencode](https://opencode.ai) that reduces AI context token consumption in large projects. It combines 5 mechanisms that act before the AI reads (semantic index), while it reads (tool interception), and after it reads (output compression + history compaction + semantic compression).

## What it does

| # | Mechanism | Savings | Source |
|---|-----------|---------|--------|
| 1 | Semantic index (`context_search`) | 23.4% | `indexer.ts`, `search.ts` |
| 2 | Tool interception (read/grep/glob/bash) | ~20–25% | `intercept.ts` |
| 3 | Output compression | 94.4% | `compress.ts` |
| 4 | History compaction | 82.3% | `compact.ts` |
| 5 | Semantic compression (test/lint/build) | ~252k tokens/session* | `compress.ts:37` |

*Live session measurement, not synthetic benchmark.

**Combined: 73.3% reduction** (measured by the included benchmark at `test/benchmark.ts` using cl100k_base tokenizer).

## How it works

### 1. Semantic index (SQLite + FTS5)

On startup, the plugin walks your project and extracts every function, class, interface, type, and enum into a local SQLite database with FTS5 + trigram tokenizer. `context_search` replaces `grep`/`rg` — it returns `type name @ file:line` with substring matching in <1ms, ranked by BM25. Files are auto-reindexed on save (500ms debounce, skip if hash unchanged). The AI reads only the section it needs instead of the entire file.

### 2. Tool interception

Hooks into `tool.execute.after` for `read`, `grep`, `glob`, and `bash`. In `substitute` mode (default), raw tool output is replaced with compact index snippets (12 lines by default, configurable via `CONTEXT_MANAGER_SNIPPET_LINES`). A 2000-line file read becomes a 12-line snippet. Configurable: `CONTEXT_MANAGER_INTERCEPT_MODE = off | warn | substitute`.

### 3. Output compression

Hooks into `tool.execute.after` for `read`, `bash`, `grep`, `glob`, `rg`, `fd`, `find`. Truncates output per tool type (read=25 lines, bash=30, grep=25, glob=50) and deduplicates identical lines. This is the single biggest saver: 94.4% on long outputs. An 800-line `read` becomes 25 useful lines.

### 4. History compaction

Uses opencode's `experimental.chat.messages.transform`. When context fill exceeds 60% (configurable via `CONTEXT_MANAGER_COMPACT_AT`), old tool outputs are replaced with one-line summaries while preserving structure. The last 2 turns are kept intact (`CONTEXT_MANAGER_COMPACT_KEEP`). Already-compacted outputs are tracked via per-session fingerprints to avoid re-processing. Savings: 82.3% on a 6-tool history.

### 5. Semantic compression

Detects outputs from test runners (Jest, Vitest, Mocha, pytest), linters (ESLint, Ruff), and build tools (webpack, vite, esbuild, rollup). Automatically summarizes: "X passed, Y failed" instead of 500 lines of test output. In the current session: ~252,389 tokens saved. Disable with `CONTEXT_MANAGER_SEMANTIC_COMPRESS=0`.

## Honest trade-off

The plugin adds a fixed prompt overhead: **+314 tokens/turn** (the system prompt is larger than without the plugin — P7 in the benchmark shows −413.6%).

**When it pays off:** Long sessions with many `read`/`bash`/`grep` calls. The 94.4% output compression and 82.3% history compaction dwarf the prompt overhead. Break-even: ~3–4 tool calls.

**When it doesn't:** Short sessions (1–2 questions with no tools), or tiny projects with nothing to index.

## Install

Install via the opencode plugin script:

```bash
opencode plugin add @madtech/opencode-context-manager-plugin
```

Restart opencode. The plugin auto-indexes your project, copies its skill, and is ready. No manual setup.

## Tools

| Tool | What it does |
|------|-------------|
| `context_search` | Search index by keyword (FTS5 + BM25, substring matching) |
| `context_related` | Callers, callees, imports, extends, implements for a symbol |
| `context_impact` | Files/symbols that depend on the given files |
| `context_stats` | Index stats, context fill, savings estimate |
| `context_analyze` | Re-index project or specific path |
| `context_clear` | Delete the index |
| `context_dashboard` | Open live dashboard at http://127.0.0.1:3567 |

## Dashboard

Run `context_dashboard` to open a local web UI showing real-time metrics: tokens saved, searches, context pressure, hot files, per-project breakdown, and detailed savings by mechanism. Refreshes every 3s.

## Configuration

See [CONFIG.md](CONFIG.md) for all environment variables (`CONTEXT_MANAGER_*`).

## Uninstall

Remove `"@madtech/opencode-context-manager-plugin"` from your `opencode.json` plugin array and restart. The plugin self-cleans. For full manual cleanup:

```bash
rm -rf ~/.cache/opencode/context-manager.sqlite* ~/.cache/opencode/context-manager-*.sqlite* ~/.config/opencode/skills/context-manager
```

## License

MIT
