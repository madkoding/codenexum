import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "fs"
import { join } from "path"

const PLUGIN_NAME = "context-manager-loading-shim"
const PLUGIN_SCOPE = "@madtech"
const PLUGIN_FILE = "opencode-context-manager-plugin.ts"
const NPM_NAME = "@madtech/opencode-context-manager-plugin"
const NPM_REGISTRY = `https://registry.npmjs.org/${NPM_NAME.replace("/", "%2f")}/latest`

const HOME = process.env.HOME || "/tmp"
const OPENCODE_DIR = join(HOME, ".config/opencode")
const PLUGIN_DIR = join(OPENCODE_DIR, "plugins")
const SHIM_PATH = join(PLUGIN_DIR, `${PLUGIN_NAME}.ts`)
const MAIN_PLUGIN_DIR = join(PLUGIN_DIR, PLUGIN_SCOPE)
const MAIN_PLUGIN_PATH = join(MAIN_PLUGIN_DIR, PLUGIN_FILE)
const SOURCE_DIR = join(PLUGIN_DIR, "src")
const VERSION_MARKER = join(HOME, ".cache/opencode/.context-manager-version-check")
const PENDING_UPGRADE = join(HOME, ".cache/opencode/.context-manager-pending-upgrade")

interface ShimState {
  installed: boolean
  needsRestart: boolean
  error?: string
}

const LoadingShim: Plugin = async ({ client }) => {
  const log = (level: string, message: string, extra?: Record<string, unknown>) =>
    client?.app?.log({ body: { service: "context-manager-shim", level: level as any, message, extra } }).catch(() => {})

  const toast = (title: string, message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 8000) => {
    const tui = (client as any)?.tui
    if (tui?.showToast) {
      tui.showToast({ body: { title, message, variant, duration } }).catch(() => {})
    } else if (tui?.publish) {
      tui.publish({ body: { type: "tui.toast.show", properties: { title, message, variant, duration } } }).catch(() => {})
    } else if (tui?.appendPrompt) {
      tui.appendPrompt({ body: { text: `[${title}] ${message}` } }).catch(() => {})
    }
  }

  // Fast path: show immediate feedback without blocking opencode boot.
  toast("Context Manager", "Checking installation…", "info", 10000)
  log("info", "shim loaded", { shimPath: SHIM_PATH })

  const state: ShimState = await installOrUpdate(log, toast)

  if (state.error) {
    log("error", "shim failed", { error: state.error })
    toast("Context Manager", `Setup failed: ${state.error}`, "error", 15000)
    return {}
  }

  if (state.needsRestart) {
    toast("Context Manager", "Installed. Restart opencode to activate.", "success", 10000)
    return {}
  }

  if (!existsSync(MAIN_PLUGIN_PATH)) {
    toast("Context Manager", "Plugin not found. Run install.sh or restart opencode.", "warning", 10000)
    return {}
  }

  // Dynamically load the real plugin. This import happens after opencode TUI is up.
  toast("Context Manager", "Loading…", "info", 5000)
  try {
    const mod = await import(MAIN_PLUGIN_PATH)
    const realPlugin: Plugin = mod?.default ?? mod
    if (typeof realPlugin !== "function") {
      throw new Error(`Plugin file at ${MAIN_PLUGIN_PATH} does not export a default Plugin function`)
    }
    const hooks = await realPlugin({ client, directory: (client as any)?.directory ?? process.cwd() } as any)
    toast("Context Manager", "Ready", "success", 5000)
    log("info", "plugin proxy active")
    return hooks || {}
  } catch (e) {
    const msg = String(e)
    log("error", "failed to load real plugin", { error: msg })
    toast("Context Manager", `Load failed: ${msg}`, "error", 15000)
    return {}
  }
}

async function installOrUpdate(log: (level: string, message: string, extra?: Record<string, unknown>) => void, toast: (title: string, message: string, variant?: any, duration?: number) => void): Promise<ShimState> {
  return new Promise((resolve) => {
    setImmediate(async () => {
      try {
        // 1. Determine source: prefer local repo if we can find it, otherwise npm.
        const repoDir = findRepoDir()
        if (repoDir) {
          log("info", "local repo found", { repoDir })
          await installFromRepo(repoDir, log)
          log("info", "local copy ready")
          return resolve({ installed: true, needsRestart: false })
        }

        // 2. No local repo: check npm version and trigger Bun install via marker.
        // We never run bun install ourselves inside the plugin; we just write a marker
        // that the next opencode restart will consume (or instruct the user).
        toast("Context Manager", "Checking npm version…", "info", 5000)
        const remoteVersion = await fetchRemoteVersion(log)
        const localVersion = readLocalVersion()
        if (!localVersion || (remoteVersion && remoteVersion !== localVersion)) {
          writeFileSync(PENDING_UPGRADE, remoteVersion || "latest", "utf8")
          log("info", "update available from npm", { local: localVersion, remote: remoteVersion })
          toast("Context Manager", `Update ${remoteVersion} available. Restart opencode to apply.`, "warning", 15000)
          return resolve({ installed: !!localVersion, needsRestart: true })
        }

        resolve({ installed: true, needsRestart: false })
      } catch (e) {
        resolve({ installed: false, needsRestart: false, error: String(e) })
      }
    })
  })
}

async function installFromRepo(repoDir: string, log: (level: string, message: string, extra?: Record<string, unknown>) => void): Promise<boolean> {
  const srcPlugin = join(repoDir, "plugins", PLUGIN_SCOPE, PLUGIN_FILE)
  const repoSrcDir = join(repoDir, "src")
  const repoSkillsDir = join(repoDir, "skills", "context-manager")

  if (!existsSync(srcPlugin)) {
    // Fallback to repo root plugins layout (older or dev layout)
    const altPlugin = join(repoDir, "plugins", `${PLUGIN_SCOPE}-${PLUGIN_FILE}`)
    if (!existsSync(altPlugin)) {
      throw new Error(`Cannot find plugin file in repo: ${srcPlugin}`)
    }
  }

  let changed = false
  if (!existsSync(MAIN_PLUGIN_DIR)) mkdirSync(MAIN_PLUGIN_DIR, { recursive: true })
  if (!existsSync(SOURCE_DIR)) mkdirSync(SOURCE_DIR, { recursive: true })

  const pluginFiles = [srcPlugin]
  const repoPluginRoot = join(repoDir, "plugins", `${PLUGIN_SCOPE}-${PLUGIN_FILE}`)
  if (existsSync(repoPluginRoot)) pluginFiles.push(repoPluginRoot)

  for (const src of pluginFiles) {
    if (!existsSync(src)) continue
    const dst = join(MAIN_PLUGIN_DIR, PLUGIN_FILE)
    if (!fileMatches(src, dst)) {
      copyFileSync(src, dst)
      changed = true
      log("info", "copied plugin file", { src, dst })
    }
  }

  // Copy all src files recursively (simple flat copy is enough for our structure)
  changed = copyDir(repoSrcDir, SOURCE_DIR, log) || changed

  // Install skill if missing
  const skillDstDir = join(OPENCODE_DIR, "skills", "context-manager")
  const skillSrc = join(repoSkillsDir, "SKILL.md")
  if (existsSync(skillSrc)) {
    if (!existsSync(skillDstDir)) mkdirSync(skillDstDir, { recursive: true })
    const skillDst = join(skillDstDir, "SKILL.md")
    if (!fileMatches(skillSrc, skillDst)) {
      copyFileSync(skillSrc, skillDst)
      changed = true
      log("info", "copied skill", { skillDst })
    }
  }

  // Clean stale markers
  try { rmSync(PENDING_UPGRADE, { force: true }) } catch {}
  try { rmSync(VERSION_MARKER, { force: true }) } catch {}

  return changed
}

function copyDir(src: string, dst: string, log: (level: string, message: string, extra?: Record<string, unknown>) => void): boolean {
  if (!existsSync(src)) return false
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
  let changed = false
  for (const entry of require("fs").readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) {
      changed = copyDir(s, d, log) || changed
    } else if (entry.isFile()) {
      if (!fileMatches(s, d)) {
        copyFileSync(s, d)
        changed = true
      }
    }
  }
  return changed
}

function fileMatches(a: string, b: string): boolean {
  if (!existsSync(b)) return false
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

function findRepoDir(): string | null {
  // Heuristic: look for a sibling directory of the current working directory
  // with the package name, or use CONTEXT_MANAGER_REPO env.
  const envRepo = process.env.CONTEXT_MANAGER_REPO
  if (envRepo && existsSync(join(envRepo, "src", "plugin.ts"))) return envRepo

  const cwd = process.cwd()
  const candidates = [
    join(cwd, "..", "opencode-context-manager"),
    join(HOME, "proyectos", "opencode-context-manager"),
    join(HOME, "projects", "opencode-context-manager"),
    join(HOME, "dev", "opencode-context-manager"),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, "src", "plugin.ts"))) return c
  }
  return null
}

async function fetchRemoteVersion(log: (level: string, message: string, extra?: Record<string, unknown>) => void): Promise<string | null> {
  try {
    const res = await Promise.race([
      fetch(NPM_REGISTRY),
      new Promise<Response | null>((r) => setTimeout(() => r(null), 3000)),
    ])
    if (res && res.ok) {
      const data = await res.json()
      return (data as any)?.version ?? null
    }
  } catch (e) {
    log("warn", "npm version check failed", { error: String(e) })
  }
  return null
}

function readLocalVersion(): string | null {
  const pkgPath = join(PLUGIN_DIR, "node_modules", NPM_NAME, "package.json")
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).version
  } catch {
    return null
  }
}

export default LoadingShim
