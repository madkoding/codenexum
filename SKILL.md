---
name: context-manager
description: "Use when the user mentions: context overflow, context limit, token limit, context full, large project, big repo, many files, project analysis, analyze codebase, code structure, compression, summarizer, resumir, comprimir, contexto grande, proyecto grande, archivos pesados, >50 files, >100 files, repo analysis, index project, semantic search, or any request to understand/explore an unfamiliar codebase."
---

# Context Manager

When working with large projects, be strategic about context usage to avoid hitting token limits while maintaining accuracy.

## Code Index (auto-maintained)

A code index is available via the `context_search` tool. It tracks functions, classes, interfaces, type aliases, and enums across the project. The index **auto-updates** when files are edited or created — no manual re-indexing needed.

**Always use `context_search` before reading files** to find the exact file and line number you need. This avoids blindly reading large files and wasting tokens.

Example flow:
1. `context_search "auth handler"` → finds `function handleAuth @ src/auth.ts:42`
2. Read only `src/auth.ts` around line 42
3. Saves ~90% tokens vs reading the whole file tree

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
|------|-------------|
| `context_analyze [path]` | Index a project (run once on first use, then auto-updates) |
| `context_search <query> [n]` | Search indexed code by keyword/phrase — **prefer this before reading files** |
| `context_stats` | Show indexing statistics |
| `context_clear` | Clear the local index |

## Token Budget

When context is limited, allocate tokens roughly:
- 50%: active files (full code)
- 30%: dependency signatures + current task reasoning
- 20%: search results and summaries

## Guiding the User

If context is getting tight:
1. Tell the user which compression level you're applying
2. Offer to run `context_analyze` if the project isn't indexed
3. Suggest they focus on specific files if you keep hitting limits