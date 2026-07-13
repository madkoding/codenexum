# @codenexum/electron — CodeNexum Electron app

Background app that hosts the MCP server, SQLite indexer, compression engine, and React dashboard.

## Dev

```bash
bun run --filter @codenexum/electron dev
```

Launches the Electron app with hot-reload via electron-vite.

## Build

```bash
bun run --filter @codenexum/electron package
```

Produces a distributable in `out/`.

## Features

- **Tray icon** — always present; quit from tray to stop the MCP server
- **Autostart** — toggle in tray menu or settings
- **MCP server** — listens on `:7770` (configurable via `CODENEXUM_MCP_PORT`)
- **Dashboard** — React UI inside the Electron window
- **Single instance** — only one instance runs at a time

## Structure

```
src/
  main/          — Electron main process (tray, window, lifecycle)
  mcp/           — MCP server + tools (indexer, search, compression, etc.)
  preload/       — contextBridge for renderer
  renderer/      — React dashboard (Tailwind, React Router)
```
