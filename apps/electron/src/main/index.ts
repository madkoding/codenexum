import { app, BrowserWindow, Tray, Menu, ipcMain } from "electron"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync, cpSync, readdirSync } from "fs"
import { startContextManagerMcp } from "../mcp/index.js"
import { getAppIcon } from "./icon.js"
import { UpdateManager } from "./updater.js"
import { APP_NAME, APP_VERSION } from "@codenexum/core"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged
const ROOT = isDev ? resolve(__dirname, "../..") : dirname(__dirname)

app.setName(APP_NAME)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let installScheduled = false
let updater: UpdateManager | null = null

const CONFIG_DIR = join(app.getPath("home"), ".config", "codenexum")
const MCP_CONFIG_PATH = join(CONFIG_DIR, "mcp.json")
const OPENCODE_DIR = join(app.getPath("home"), ".config", "opencode")
const OPENCODE_PLUGINS_DIR = join(OPENCODE_DIR, "plugins", "node_modules", "@codenexum", "plugin")
const OLD_PLUGIN_DIR = join(OPENCODE_DIR, "plugins", "node_modules", "@madtech", "opencode-context-manager-plugin")
const PLUGIN_SRC = isDev
  ? resolve(ROOT, "..", "..", "apps", "plugin", "dist")
  : join(process.resourcesPath, "plugin", "dist")
const PLUGIN_BUNDLED = isDev
  ? resolve(ROOT, "..", "..", "apps", "plugin", "dist", "index.bundled.js")
  : join(process.resourcesPath, "plugin", "dist", "index.bundled.js")
const PLUGIN_PKG = isDev
  ? resolve(ROOT, "..", "..", "apps", "plugin", "package.json")
  : join(process.resourcesPath, "plugin", "package.json")

const MCP_PORT = parseInt(process.env.CODENEXUM_MCP_PORT || "7770", 10)
const MCP_KEY = "codenexum"

function writeMcpConfig(port: number) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ port, url: `http://127.0.0.1:${port}` }, null, 2))
}

function readOpencodeConfig(cp: string): any | null {
  if (!existsSync(cp)) return null
  try {
    const raw = readFileSync(cp, "utf-8")
    const json = raw
      .replace(/^(\s*)\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1")
    return JSON.parse(json)
  } catch (e) {
    console.warn(`[codenexum] could not parse ${cp}:`, e)
    return null
  }
}

function writeOpencodeConfig(cp: string, cfg: any) {
  writeFileSync(cp, JSON.stringify(cfg, null, 2) + "\n")
}

function pickOpencodeConfigPath(): { path: string; cfg: any | null } {
  const jsonPath = join(OPENCODE_DIR, "opencode.json")
  const jsoncPath = join(OPENCODE_DIR, "opencode.jsonc")
  if (existsSync(jsonPath)) return { path: jsonPath, cfg: readOpencodeConfig(jsonPath) }
  if (existsSync(jsoncPath)) return { path: jsoncPath, cfg: readOpencodeConfig(jsoncPath) }
  return { path: jsonPath, cfg: null }
}

function syncMcpEntry(cfg: any, mcpEntry: any): { cfg: any; changed: boolean } {
  if (!cfg.mcp || typeof cfg.mcp !== "object") cfg.mcp = {}
  const existing = cfg.mcp[MCP_KEY]
  if (!existing || existing.url !== mcpEntry.url || existing.enabled === false) {
    cfg.mcp[MCP_KEY] = mcpEntry
    return { cfg, changed: true }
  }
  return { cfg, changed: false }
}

function syncPluginEntry(cfg: any): { cfg: any; changed: boolean } {
  const plugins: string[] = Array.isArray(cfg.plugin) ? cfg.plugin : []
  const filtered = plugins.filter((p: string) => p !== "@madtech/opencode-context-manager-plugin")
  if (!filtered.includes("@codenexum/plugin")) {
    filtered.push("@codenexum/plugin")
    cfg.plugin = filtered
    return { cfg, changed: true }
  }
  if (filtered.length !== plugins.length) {
    cfg.plugin = filtered
    return { cfg, changed: true }
  }
  return { cfg, changed: false }
}

function installOpencodePlugin() {
  if (!existsSync(PLUGIN_SRC)) {
    console.warn(`[codenexum] Plugin dist not found at ${PLUGIN_SRC} — skipping install`)
    return
  }
  if (!existsSync(OPENCODE_DIR)) {
    console.warn(`[codenexum] opencode config not found at ${OPENCODE_DIR} — skipping plugin install`)
    return
  }

  if (existsSync(OLD_PLUGIN_DIR)) {
    rmSync(OLD_PLUGIN_DIR, { recursive: true, force: true })
    console.log(`[codenexum] Removed old plugin at ${OLD_PLUGIN_DIR}`)
  }

  if (existsSync(OPENCODE_PLUGINS_DIR)) rmSync(OPENCODE_PLUGINS_DIR, { recursive: true, force: true })
  mkdirSync(OPENCODE_PLUGINS_DIR, { recursive: true })

  const EXCLUDED = new Set(["index.bundled.js", "index.d.ts", "index.d.mts"])
  for (const f of readdirSync(PLUGIN_SRC)) {
    if (EXCLUDED.has(f)) continue
    cpSync(join(PLUGIN_SRC, f), join(OPENCODE_PLUGINS_DIR, f), { recursive: true })
  }

  if (existsSync(PLUGIN_BUNDLED)) {
    cpSync(PLUGIN_BUNDLED, join(OPENCODE_PLUGINS_DIR, "index.js"))
  } else if (existsSync(join(PLUGIN_SRC, "index.js"))) {
    console.warn(`[codenexum] Bundled plugin not found at ${PLUGIN_BUNDLED} — using unbundled dist (may fail if @opencode-ai/plugin cannot be resolved)`)
    cpSync(join(PLUGIN_SRC, "index.js"), join(OPENCODE_PLUGINS_DIR, "index.js"))
  } else {
    console.error(`[codenexum] No plugin entry found in ${PLUGIN_SRC} — install aborted`)
    return
  }

  if (existsSync(PLUGIN_PKG)) {
    const pkg = JSON.parse(readFileSync(PLUGIN_PKG, "utf-8"))
    delete pkg.dependencies
    delete pkg.devDependencies
    writeFileSync(join(OPENCODE_PLUGINS_DIR, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
  } else {
    writeFileSync(
      join(OPENCODE_PLUGINS_DIR, "package.json"),
      JSON.stringify({ name: "@codenexum/plugin", version: APP_VERSION, type: "module", main: "./index.js" }, null, 2) + "\n"
    )
  }

  const mcpUrl = `http://127.0.0.1:${MCP_PORT}`
  const mcpEntry = { type: "remote", url: mcpUrl, enabled: true }
  const { path: targetConfig, cfg: existingCfg } = pickOpencodeConfigPath()
  const cfg = existingCfg ?? { plugin: [] as string[], mcp: {} as Record<string, any> }

  const mcpSync = syncMcpEntry(cfg, mcpEntry)
  const pluginSync = syncPluginEntry(mcpSync.cfg)

  if (mcpSync.changed || pluginSync.changed || !existingCfg) {
    writeOpencodeConfig(targetConfig, pluginSync.cfg)
    if (!existingCfg) {
      console.log(`[codenexum] Created ${targetConfig} with @codenexum/plugin and MCP server`)
    } else {
      const changes: string[] = []
      if (mcpSync.changed) changes.push("MCP entry")
      if (pluginSync.changed) changes.push("@codenexum/plugin")
      console.log(`[codenexum] Updated ${targetConfig}: added ${changes.join(" and ")}`)
    }
  } else {
    console.log(`[codenexum] ${targetConfig} already up to date (plugin + MCP entry present)`)
  }

  console.log(`[codenexum] Plugin installed to ${OPENCODE_PLUGINS_DIR}`)
}

function updateMcpConfig(port: number) {
  const mcpUrl = `http://127.0.0.1:${port}`
  const mcpEntry = { type: "remote", url: mcpUrl, enabled: true }
  const configs = [join(OPENCODE_DIR, "opencode.json"), join(OPENCODE_DIR, "opencode.jsonc")]
  for (const cp of configs) {
    const cfg = readOpencodeConfig(cp)
    if (!cfg) continue
    const mcpSync = syncMcpEntry(cfg, mcpEntry)
    if (mcpSync.changed) {
      writeOpencodeConfig(cp, mcpSync.cfg)
      console.log(`[codenexum] MCP config updated to port ${port} in ${cp}`)
    }
  }
}

function cleanOldDatabases() {
  const oldCache = join(app.getPath("home"), ".cache", "opencode")
  if (!existsSync(oldCache)) return
  const files = readdirSync(oldCache).filter(f => (f.startsWith("context-manager-") || f.startsWith("codenexum-")) && f.endsWith(".sqlite"))
  for (const f of files) {
    try { rmSync(join(oldCache, f)) } catch {}
  }
  console.log(`[codenexum] Cleaned ${files.length} old v2 database(s)`)
}

let mcpActualPort = MCP_PORT

ipcMain.handle("get-mcp-url", async () => {
  const url = `http://127.0.0.1:${mcpActualPort}`
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) return url
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  return url
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  installOpencodePlugin()
  cleanOldDatabases()
  const server = await startContextManagerMcp(MCP_PORT)
  const actualPort = server?.port || MCP_PORT
  mcpActualPort = actualPort
  updateMcpConfig(actualPort)
  writeMcpConfig(actualPort)

  updater = new UpdateManager()
  updater.init()
  const u = updater

  ipcMain.handle("update:check", () => u.check())
  ipcMain.handle("update:download", () => u.download())
  ipcMain.handle("update:install", () => {
    installScheduled = true
    isQuitting = true
    u.installAndRestart()
  })
  ipcMain.handle("update:status", () => u.getStatus())

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"))

  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  tray = new Tray(getAppIcon())
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Dashboard", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Check for updates…", click: () => u.check() },
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on("double-click", () => mainWindow?.show())
})

app.on("window-all-closed", () => {})
app.on("before-quit", (e) => {
  isQuitting = true
  if (installScheduled) return
  if (updater && updater.status === "downloaded") {
    e.preventDefault()
    installScheduled = true
    updater.installAndRestart()
  }
})
