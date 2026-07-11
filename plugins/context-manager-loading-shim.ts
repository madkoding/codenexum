import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, unlinkSync, readFileSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { spawn } from "child_process"

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
const PENDING_UPGRADE = join(
  process.env.HOME || "/tmp",
  ".cache/opencode/.context-manager-pending-upgrade"
)
const NPM_REGISTRY = "https://registry.npmjs.org/@madtech%2fopencode-context-manager-plugin/latest"

const ShimPlugin: Plugin = async ({ client }) => {
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
    pluginEnabled = Array.isArray((cfg as any)?.plugin) && (cfg as any).plugin.some((p: string) => p.includes(PLUGIN_NAME))
  } catch (e) {
    log("warn", "config.get failed; assuming plugin not enabled", { error: String(e) })
  }

  if (!pluginEnabled) {
    log("info", "main plugin not in config; removing shim")
    selfDestruct()
    return {}
  }

  const cached = existsSync(BUN_CACHE) || existsSync(BUN_CACHE_LATEST)

  // ponytail: if pending-upgrade marker exists, launch a detached process that
  // deletes the bun cache after 2s (gives opencode time to load plugin code into memory).
  // The process survives opencode's exit; unref() prevents opencode from waiting on it.
  if (existsSync(PENDING_UPGRADE)) {
    log("info", "pending-upgrade marker found; scheduling cache deletion")
    toast("Context Manager", "Applying update… restart opencode to complete.", "info", 15000)
    try {
      const cmd = `sleep 2 && rm -rf "${BUN_CACHE}" "${BUN_CACHE_LATEST}" "${PENDING_UPGRADE}"`
      const child = spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" })
      child.unref()
      log("info", "detached cache-deletion process spawned", { pid: child.pid })
    } catch (e) {
      log("warn", "failed to spawn cache-deletion process", { error: String(e) })
      try { rmSync(PENDING_UPGRADE, { force: true }) } catch {}
    }
    return {}
  }

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

  // ponytail: version-check is read-only — never deletes cache while opencode is running.
  // Throttled to once/day via a marker file containing ISO date.
  // Marker is written BEFORE the fetch so throttle works even if fetch fails.
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
        writeFileSync(VERSION_MARKER, today, "utf8")

        const cacheDir = existsSync(BUN_CACHE_LATEST) ? BUN_CACHE_LATEST : BUN_CACHE
        const pkgPath = join(cacheDir, "node_modules", "@madtech", "opencode-context-manager-plugin", "package.json")
        if (!existsSync(pkgPath)) {
          log("warn", "cached package.json not found; skipping version-check", { pkgPath })
          return
        }
        const localPkg = JSON.parse(readFileSync(pkgPath, "utf8"))
        const localVersion = localPkg.version

        // Promise.race with timeout — more reliable than AbortController in plugin context
        let remoteVersion: string | null = null
        try {
          const res = await Promise.race([
            fetch(NPM_REGISTRY),
            new Promise<Response | null>(r => setTimeout(() => r(null), 3000)),
          ])
          if (res && res.ok) {
            const remotePkg = await res.json()
            remoteVersion = (remotePkg as any)?.version ?? null
          }
        } catch (e) {
          log("warn", "npm fetch failed", { error: String(e) })
        }

        if (!remoteVersion) {
          log("warn", "could not fetch remote version")
          return
        }

        if (localVersion === remoteVersion) {
          log("info", "plugin up to date", { local: localVersion, remote: remoteVersion })
          return
        }

        log("info", "new version available; writing pending-upgrade marker", { local: localVersion, remote: remoteVersion })
        writeFileSync(PENDING_UPGRADE, remoteVersion, "utf8")
        toast("Context Manager", `Update ${remoteVersion} available (have ${localVersion}). Restart opencode to apply.`, "warning", 30000)
      } catch (e) {
        log("warn", "version-check failed", { error: String(e) })
      }
    })()
  })

  return {}
}

export default ShimPlugin