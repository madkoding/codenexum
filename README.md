# opencode-context-manager

Plugin + Skill that lets [opencode](https://opencode.ai) handle large projects with smart context compression and code search.

## What's included

- **Native TS plugin** — 4 tools + 2 hooks the LLM uses directly:
  - `context_analyze` — indexes a project: parses functions, classes, interfaces, type aliases, and enums
  - `context_search` — keyword search over the local index
  - `context_stats` — shows index statistics
  - `context_clear` — clears the index
  - **Auto-update**: the index updates itself when you edit files (`event` hook)
  - **System prompt**: injects instructions telling the LLM to use `context_search` before reading files (`experimental.chat.system.transform` hook)
- **SKILL.md** — teaches opencode to classify files into 3 levels and compress context.

No Python, no venv, no heavy external dependencies. One dependency: `@opencode-ai/plugin` (installed automatically).

## Installation

```bash
git clone https://github.com/madkoding/opencode-context-manager.git
cd opencode-context-manager
./install.sh
# Restart opencode
```

The script:
1. Copies the plugin to `~/.config/opencode/plugins/`
2. Copies SKILL.md to `~/.config/opencode/skills/context-manager/`
3. Installs `@opencode-ai/plugin` if not present
4. Adds the plugin to `opencode.jsonc` automatically

## Uninstallation

```bash
./uninstall.sh
```

## Tools

| Tool | Args | Usage |
|------|------|-------|
| `context_analyze` | `path` (optional) | Index the current project or a specific path |
| `context_search` | `query` (required), `n` (optional, default 10) | Search indexed code |
| `context_stats` | — | View index status |
| `context_clear` | — | Clear the index |

## How it works

1. `context_analyze` walks the directory tree, ignoring `node_modules/`, `.git/`, etc.
2. For each code file (`.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, etc.) it extracts functions, classes, interfaces, type aliases, and enums using regular expressions.
3. Stores everything in a JSON file at `~/.cache/opencode/context-manager.json`.
4. `context_search` does token matching with scoring: exact name matches weigh more than partial content matches.
5. **Auto-update**: when a file changes, only that file is re-parsed and its chunks updated in the index (with a 500ms debounce and hashing to avoid unnecessary re-parses).
6. **System prompt**: each turn, if an index exists, a `<context-manager>` block is injected telling the LLM to use `context_search` before reading files.

## Supported languages

Python, JavaScript/TypeScript, Go, Rust, Java, Ruby, PHP, C/C++, C#

## Requirements

- opencode v1.x
- [Bun](https://bun.sh) (to install `@opencode-ai/plugin`)