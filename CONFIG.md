# Configuration

All settings are environment variables prefixed with `CONTEXT_MANAGER_`.

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
| `CONTEXT_MANAGER_DASHBOARD_PORT` | `3567` | Port for the local web dashboard. |
| `CONTEXT_MANAGER_DASHBOARD_AUTO_START` | `1` | Auto-start dashboard on opencode launch. |
| `CONTEXT_MANAGER_MAX_FILES` | `10000` | Max files to walk during auto-index. |
| `CONTEXT_MANAGER_MAX_FILE_BYTES` | `1048576` (1 MiB) | Skip files larger than this to avoid indexing generated bundles. |
| `CONTEXT_MANAGER_CACHE_DIR` | `~/.cache/opencode` | Directory for the SQLite index and caches. |