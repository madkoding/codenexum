import { app, BrowserWindow, Tray, Menu, ipcMain } from "electron"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { existsSync, rmSync, readdirSync } from "fs"
import { spawnSync } from "child_process"
import { startContextManagerMcp } from "../mcp/index.js"
import { getAppIcon, getTrayIcon } from "./icon.js"
import { UpdateManager } from "./updater.js"
import { APP_NAME, APP_VERSION } from "@codenexum/core"
import { getSettings } from "../mcp/settings.js"
import {
  installOpencodePlugin,
  updateMcpConfig,
  writeMcpConfigFile,
} from "./plugin-install.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged
const ROOT = isDev ? resolve(__dirname, "../..") : dirname(__dirname)

app.setName(APP_NAME)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let installScheduled = false
let isAppQuitting = false
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

function cleanOldDatabases() {
  const oldCache = join(app.getPath("home"), ".cache", "opencode")
  if (!existsSync(oldCache)) return
  const files = readdirSync(oldCache).filter(f => (f.startsWith("context-manager-") || f.startsWith("codenexum-")) && f.endsWith(".sqlite"))
  for (const f of files) {
    try { rmSync(join(oldCache, f)) } catch {}
  }
  console.log(`[codenexum] Cleaned ${files.length} old v2 database(s)`)
}

function isOpencodeProcessRunning(): boolean {
  try {
    const res = spawnSync("pgrep", ["-x", "opencode"], { encoding: "utf-8" })
    if (res.status === 0 && res.stdout.trim().length > 0) return true
  } catch { /* pgrep not on PATH (Windows); fall through */ }
  try {
    const res = spawnSync("tasklist", ["/FI", "IMAGENAME eq opencode.exe"], { encoding: "utf-8" })
    if (res.status === 0 && /opencode\.exe/i.test(res.stdout)) return true
  } catch { /* tasklist not on PATH */ }
  return false
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
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

function buildTrayMenu(): Menu {
  const u = updater
  const visible = mainWindow?.isVisible() && mainWindow?.isFocused()
  return Menu.buildFromTemplate([
    {
      label: visible ? "Hide Dashboard" : "Show Dashboard",
      click: () => {
        if (!mainWindow) return
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
        refreshTrayMenu()
      },
    },
    { type: "separator" },
    { label: "Check for updates…", click: () => u?.check() },
    { type: "separator" },
    { label: "Quit " + APP_NAME, click: () => { isAppQuitting = true; installScheduled = false; app.quit() } },
  ])
}

function refreshTrayMenu() {
  if (!tray) return
  tray.setContextMenu(buildTrayMenu())
}

function createTray() {
  if (tray) return
  const size: 16 | 32 | 64 = process.platform === "darwin" ? 16 : process.platform === "linux" ? 32 : 32
  const icon = getTrayIcon(size)
  if (icon.isEmpty()) {
    console.warn(`[codenexum] Tray icon not found — tray disabled`)
    return
  }
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(buildTrayMenu())
  if (process.platform !== "darwin") {
    tray.on("click", () => {
      if (!mainWindow) return
      if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide()
      else { mainWindow.show(); mainWindow.focus() }
      refreshTrayMenu()
    })
    tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); refreshTrayMenu() })
  }
}

function destroyTray() {
  if (!tray) return
  tray.destroy()
  tray = null
}

function applyCloseBehavior() {
  if (!mainWindow) return
  const closeToTray = getSettings().closeToTray === true
  if (closeToTray) {
    createTray()
    mainWindow.removeAllListeners("close")
    mainWindow.on("close", (e) => {
      if (!mainWindow) return
      if (isAppQuitting) return
      e.preventDefault()
      mainWindow.hide()
      refreshTrayMenu()
    })
    mainWindow.on("show", () => refreshTrayMenu())
    mainWindow.on("hide", () => refreshTrayMenu())
    mainWindow.on("focus", () => refreshTrayMenu())
    mainWindow.on("blur", () => refreshTrayMenu())
  } else {
    destroyTray()
    mainWindow.removeAllListeners("close")
  }
}

app.whenReady().then(async () => {
  cleanOldDatabases()

  const server = await startContextManagerMcp(MCP_PORT)
  const actualPort = server?.port || MCP_PORT
  mcpActualPort = actualPort
  writeMcpConfigFile(MCP_CONFIG_PATH, actualPort)
  updateMcpConfig({ opencodeDir: OPENCODE_DIR }, actualPort)

  const opencodeWasRunning = isOpencodeProcessRunning()

  updater = new UpdateManager()
  updater.init()
  const u = updater

  ipcMain.handle("update:check", () => u.check())
  ipcMain.handle("update:download", () => u.download())
  ipcMain.handle("update:install", () => {
    installScheduled = true
    u.installAndRestart()
  })
  ipcMain.handle("update:status", () => u.getStatus())

  ipcMain.handle("settings:get", () => getSettings())
  ipcMain.handle("settings:reload-close-behavior", () => { applyCloseBehavior() })

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

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
    applyCloseBehavior()
  })

  // ponytail: plugin install runs off the critical path. The user sees the
  // dashboard immediately; the file copy / cfg merge happens in the background.
  setImmediate(() => {
    try {
      installOpencodePlugin(
        {
          pluginSrc: PLUGIN_SRC,
          pluginBundled: PLUGIN_BUNDLED,
          pluginPkg: PLUGIN_PKG,
          opencodeDir: OPENCODE_DIR,
          opencodePluginsDir: OPENCODE_PLUGINS_DIR,
          oldPluginDir: OLD_PLUGIN_DIR,
          appVersion: APP_VERSION,
        },
        { mcpPort: actualPort, opencodeAlreadyRunning: opencodeWasRunning },
      )
    } catch (e) {
      console.error(`[codenexum] plugin install crashed:`, e)
    }
  })
})

app.on("window-all-closed", () => {
  if (getSettings().closeToTray === true) return
  app.quit()
})

app.on("before-quit", (e) => {
  isAppQuitting = true
  if (installScheduled) return
  if (updater && updater.status === "downloaded") {
    e.preventDefault()
    installScheduled = true
    updater.installAndRestart()
  }
})
