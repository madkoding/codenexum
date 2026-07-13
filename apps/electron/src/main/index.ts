import { app, BrowserWindow, Tray, Menu, ipcMain } from "electron"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync, cpSync, readdirSync } from "fs"
import { startContextManagerMcp } from "../mcp/index.js"
import { getAppIcon } from "./icon.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged
const ROOT = isDev ? resolve(__dirname, "../..") : dirname(__dirname)

const APP_NAME = "CodeNexum"
app.setName(APP_NAME)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const CONFIG_DIR = join(app.getPath("home"), ".config", "codenexum")
const MCP_CONFIG_PATH = join(CONFIG_DIR, "mcp.json")
const OPENCODE_DIR = join(app.getPath("home"), ".config", "opencode")
const OPENCODE_PLUGINS_DIR = join(OPENCODE_DIR, "plugins", "node_modules", "@codenexum", "plugin")
const OLD_PLUGIN_DIR = join(OPENCODE_DIR, "plugins", "node_modules", "@madtech", "opencode-context-manager-plugin")
const PLUGIN_SRC = isDev
  ? resolve(ROOT, "..", "..", "apps", "plugin", "dist")
  : join(process.resourcesPath, "plugin", "dist")
const PLUGIN_PKG = isDev
  ? resolve(ROOT, "..", "..", "apps", "plugin", "package.json")
  : join(process.resourcesPath, "plugin", "package.json")

const MCP_PORT = parseInt(process.env.CODENEXUM_MCP_PORT || "7770", 10)
const MCP_KEY = "codenexum"

function writeMcpConfig(port: number) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ port, url: `http://127.0.0.1:${port}` }, null, 2))
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
  for (const f of readdirSync(PLUGIN_SRC)) {
    cpSync(join(PLUGIN_SRC, f), join(OPENCODE_PLUGINS_DIR, f), { recursive: true })
  }
  if (existsSync(PLUGIN_PKG)) {
    cpSync(PLUGIN_PKG, join(OPENCODE_PLUGINS_DIR, "package.json"))
  }
  console.log(`[codenexum] Plugin installed to ${OPENCODE_PLUGINS_DIR}`)

  const configPath = join(OPENCODE_DIR, "opencode.jsonc")
  const configPathJson = join(OPENCODE_DIR, "opencode.json")
  const mcpUrl = `http://127.0.0.1:${MCP_PORT}`
  const mcpEntry = { type: "remote", url: mcpUrl, enabled: true }

  for (const cp of [configPath, configPathJson]) {
    if (!existsSync(cp)) continue
    const raw = readFileSync(cp, "utf-8")
    const json = raw
      .replace(/^(\s*)\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1")
    let cfg: any
    try { cfg = JSON.parse(json) } catch (e) { continue }
    if (!cfg.mcp || typeof cfg.mcp !== "object") cfg.mcp = {}
    const existing = cfg.mcp[MCP_KEY]
    if (!existing || existing.url !== mcpUrl || existing.enabled === false) {
      cfg.mcp[MCP_KEY] = mcpEntry
      const updated = JSON.stringify(cfg, null, 2)
      writeFileSync(cp, updated + "\n")
      console.log(`[codenexum] Configured MCP server in ${cp}`)
    }
  }

  if (!existsSync(configPath)) {
    const initial = { plugin: ["@codenexum/plugin"], mcp: { [MCP_KEY]: mcpEntry } }
    writeFileSync(configPath, JSON.stringify(initial, null, 2) + "\n")
    console.log(`[codenexum] Created ${configPath} with @codenexum/plugin and MCP server`)
    return
  }
  const raw = readFileSync(configPath, "utf-8")
  const json = raw
    .replace(/^(\s*)\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1")
  let cfg: any
  try { cfg = JSON.parse(json) } catch (e) { console.warn("[codenexum] could not parse opencode.jsonc:", e); return }
  const plugins: string[] = Array.isArray(cfg.plugin) ? cfg.plugin : []
  const filtered = plugins.filter((p: string) => p !== "@madtech/opencode-context-manager-plugin")
  if (!filtered.includes("@codenexum/plugin")) filtered.push("@codenexum/plugin")
  const changed = filtered.length !== plugins.length || !plugins.includes("@codenexum/plugin")
  if (changed) {
    cfg.plugin = filtered
    const updated = JSON.stringify(cfg, null, 2)
    writeFileSync(configPath, updated + "\n")
    console.log("[codenexum] Configured @codenexum/plugin in opencode.jsonc")
  }
}

function updateMcpConfig(port: number) {
  const configPath = join(OPENCODE_DIR, "opencode.jsonc")
  const configPathJson = join(OPENCODE_DIR, "opencode.json")
  const mcpUrl = `http://127.0.0.1:${port}`
  const mcpEntry = { type: "remote", url: mcpUrl, enabled: true }
  for (const cp of [configPath, configPathJson]) {
    if (!existsSync(cp)) continue
    try {
      const raw = readFileSync(cp, "utf-8")
      const json = raw.replace(/^(\s*)\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,(\s*[}\]])/g, "$1")
      const cfg = JSON.parse(json)
      if (!cfg.mcp || typeof cfg.mcp !== "object") cfg.mcp = {}
      const existing = cfg.mcp[MCP_KEY]
      if (!existing || existing.url !== mcpUrl || existing.enabled === false) {
        cfg.mcp[MCP_KEY] = mcpEntry
        writeFileSync(cp, JSON.stringify(cfg, null, 2) + "\n")
        console.log(`[codenexum] MCP config updated to port ${port} in ${cp}`)
      }
    } catch {}
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
    { label: "Quit", click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on("double-click", () => mainWindow?.show())
})

app.on("window-all-closed", () => {})
app.on("before-quit", () => { isQuitting = true })
