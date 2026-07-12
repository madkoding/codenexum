# opencode-context-manager

A search engine for your codebase, built into [opencode](https://opencode.ai). Instead of the AI reading entire files to find one function, it searches a local index first — reads only what it needs. ~90% fewer tokens spent on code lookups.

## Install

Add the package to your opencode config:

```json
{ "plugin": ["@madtech/opencode-context-manager-plugin"] }
```

Restart opencode. The plugin auto-indexes your project, copies its skill, and is ready. No manual setup.

## What it does

On startup, the plugin walks your project, extracts every function, class, interface, type, and enum into a local SQLite database (FTS5 + trigram tokenizer). Then:

- `context_search` replaces `grep`/`rg` — returns `type name @ file:line` with substring matching in <1ms
- `context_related` / `context_impact` — trace callers, callees, imports, dependencies
- Files are auto-reindexed on save (500ms debounce, skip if hash unchanged)
- Tool interception (`read`/`grep`/`glob`/`bash`) substitutes raw output with compact index snippets

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