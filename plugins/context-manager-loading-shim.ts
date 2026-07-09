import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, unlinkSync, readFileSync, writeFileSync, rmSync } from "fs"
import { join } from "path"

const SHIM_PATH = join(
  process.env.HOME || "/tmp",
  ".config/opencode/plugins/context-manager-loading-shim.ts"
)
const PLUGIN_NAME = "@madtech/opencode-context-manager-plugin"
const BUN_CACHE = join(
  process.env.HOME || "/tmp",
  ".cache/opencode/packages/@madtech/opencode-context-manager-plugin"
)
const BUN_CACHE_LATEST = join(
  process.env.HOME || "/tmp",
  ".cache/opencode/packages/@madtech/opencode-context-manager-plugin@latest"
)
const VERSION_MARKER = join(
  process.env.HOME || "/tmp",
  ".cache/opencode/.context-manager-version-check"
)
const NPM_REGISTRY = "https://registry.npmjs.org/@madtech%2fopencode-context-manager-plugin/latest"

const ShimPlugin: Plugin = async ({ client }) => {
  const log = (level: string, message: string, extra?: Record<string, unknown>) =>
    client?.app?.log({ body: { service: "context-manager-shim", level, message, extra } }).catch(() => {})

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

  const selfDestruct = () => {
    try {
      unlinkSync(SHIM_PATH)
      log("info", "shim self-deleted (plugin not configured)")
    } catch (e) {
      log("warn", "shim self-delete failed", { error: String(e) })
    }
  }

  let pluginEnabled = false
  try {
    const cfg = await client.config.get()
    pluginEnabled = Array.isArray(cfg?.plugin) && cfg.plugin.some((p: string) => p.includes(PLUGIN_NAME))
  } catch (e) {
    log("warn", "config.get failed; assuming plugin not enabled", { error: String(e) })
  }

  if (!pluginEnabled) {
    log("info", "main plugin not in config; removing shim")
    selfDestruct()
    return {}
  }

  const cached = existsSync(BUN_CACHE) || existsSync(BUN_CACHE_LATEST)
  if (!cached) {
    log("info", "shim loaded — main plugin is being installed/downloaded")
    toast("Context Manager", "Installing plugin…", "info", 30000)

    setTimeout(() => {
      toast("Context Manager", "Still loading… (first install can take 30-60s)", "info", 30000)
    }, 15000)

    setTimeout(() => {
      toast("Context Manager", "If the TUI is still blank, the main plugin is still downloading. Please wait.", "info", 30000)
    }, 45000)

    return {}
  }

  // ponytail: version-check runs fire-and-forget after first-install is handled.
  // Throttled to once/day via a marker file containing ISO date.
  setImmediate(() => {
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10)
        if (existsSync(VERSION_MARKER)) {
          const last = readFileSync(VERSION_MARKER, "utf8").trim()
          if (last === today) {
            log("debug", "version-check already done today", { last })
            return
          }
        }

        const cacheDir = existsSync(BUN_CACHE_LATEST) ? BUN_CACHE_LATEST : BUN_CACHE
        const pkgPath = join(cacheDir, "node_modules", "@madtech", "opencode-context-manager-plugin", "package.json")
        if (!existsSync(pkgPath)) {
          log("warn", "cached package.json not found; skipping version-check", { pkgPath })
          return
        }
        const localPkg = JSON.parse(readFileSync(pkgPath, "utf8"))
        const localVersion = localPkg.version

        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 3000)
        const res = await fetch(NPM_REGISTRY, { signal: ctrl.signal })
        clearTimeout(timer)
        if (!res.ok) {
          log("warn", "npm registry fetch failed", { status: res.status })
          return
        }
        const remotePkg = await res.json()
        const remoteVersion = (remotePkg as any)?.version
        if (!remoteVersion) {
          log("warn", "npm registry returned no version", { body: remotePkg })
          return
        }

        writeFileSync(VERSION_MARKER, today, "utf8")

        if (localVersion === remoteVersion) {
          log("info", "plugin up to date", { local: localVersion, remote: remoteVersion })
          return
        }

        log("info", "new version available; clearing bun cache", { local: localVersion, remote: remoteVersion })
        toast("Context Manager", `Update ${remoteVersion} available (have ${localVersion}). Restart opencode to apply.`, "warning", 15000)

        try { rmSync(BUN_CACHE, { recursive: true, force: true }) } catch {}
        try { rmSync(BUN_CACHE_LATEST, { recursive: true, force: true }) } catch {}
        log("info", "bun cache cleared for plugin upgrade", { remote: remoteVersion })
      } catch (e) {
        log("warn", "version-check failed", { error: String(e) })
      }
    })()
  })

  return {}
}

export default ShimPlugin