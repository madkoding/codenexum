---
name: context-manager
description: "Use when the user mentions: context overflow, context limit, token limit, context full, large project, big repo, many files, project analysis, analyze codebase, code structure, compression, summarizer, resumir, comprimir, contexto grande, proyecto grande, archivos pesados, >50 files, >100 files, repo analysis, index project, semantic search, or any request to understand/explore an unfamiliar codebase."
---

# Context Manager

When working with large projects, be strategic about context usage to avoid hitting token limits while maintaining accuracy.

## Code Index (auto-maintained)

A code index is available via the `context_search` tool. It tracks functions, classes, interfaces, type aliases, enums, imports, exports, and more across the project. The index **auto-updates** when files are edited or created — no manual re-indexing needed.

**Always use `context_search` before reading files** to find the exact file and line number you need. This avoids blindly reading large files and wasting tokens.

### Search filters

You can narrow results with prefixes:

| Filter | Example | What it does |
|---|---|---|
| `type:` | `class:User` | Only symbols of that type |
| `file:` | `file:auth.ts` | Only symbols in files matching the substring |
| `lang:` | `lang:ts` | Only symbols in TypeScript files |

Filters can be combined with free text: `function:auth file:src`.

## Relationship Graph (1-level)

The index also records lightweight relationships between symbols: imports, calls, extends, and implements. These are **heuristic, one-level links** — good for tracing a change, not a full code graph.

Use them when the user asks:
- "What uses this function?"
- "If I change X, what breaks?"
- "Where is this class extended?"

| Tool | Description |
|---|---|
| `context_related file.ts:symbolName [n]` | Callers, callees, imports, extends, implements |
| `context_impact ["file1.ts", "file2.ts"] [n]` | Files/symbols that depend on the given files |

### Example flow

1. `context_search "authenticate"` → `function authenticate @ src/auth.ts:4-7`
2. `context_related "src/auth.ts:authenticate"` → sees callers like `login`, `refresh`.
3. `context_impact ["src/auth.ts"]` → sees tests and modules that import `src/auth.ts`.

### Example flow

1. `context_search "auth handler"` → returns something like:
   ```
   function handleAuth @ src/auth.ts:42-48
     42│ function handleAuth(req, res, next) {
     43│   const token = req.headers.authorization;
     44│   return verify(token);
     45│ }
   ```
2. If the snippet is enough to answer the user's question, stop there.
3. Only read `src/auth.ts` if you need surrounding context.
4. Saves ~90% tokens vs reading the whole file tree.

## Compression Strategy

Classify files into three tiers:

1. **Active files** (high detail) — files the user is actively editing or discussing. Include full content.
2. **Dependencies** (medium detail) — imported/required files. Include only signatures, exports, and type definitions.
3. **Rest of repo** (low detail) — everything else. Include only a one-line summary per file, unless the user specifically asks about it.

When you detect the context is getting full:
- Summarize low-detail files first
- Then compress medium-detail files to signatures only
- If still tight, strip docstrings and comments from active files

## Tools

| Tool | Description |
|---|---|
| `context_analyze [path]` | Index a project (run once on first use, then auto-updates) |
| `context_search <query> [n] [snippet=N]` | Search indexed code by keyword/phrase — **prefer this before reading files** |
| `context_related file.ts:symbol [n]` | Show callers, callees, imports, extends, implements |
| `context_impact ["file.ts"] [n]` | Files/symbols that depend on the given files |
| `context_stats` | Show indexing statistics |
| `context_clear` | Clear the local index |

## Token Budget

When context is limited, allocate tokens roughly:
- 50%: active files (full code)
- 30%: dependency signatures + current task reasoning
- 20%: search results and summaries

## Snippet-Only Mode

Search results now include a body snippet and exact line range. **If the snippet is enough to answer the user's question, do not read the file.** This is the default mode and saves the most tokens.

When to open the file:
- The snippet is truncated mid-block or mid-function.
- You need to see surrounding definitions or multiple related symbols.
- The user explicitly asks for the full file or line range beyond the snippet.

## Guiding the User

If context is getting tight:
1. Tell the user which compression level you're applying
2. Offer to run `context_analyze` if the project isn't indexed
3. Suggest they focus on specific files if you keep hitting limits
