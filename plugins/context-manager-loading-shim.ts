import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, unlinkSync } from "fs"
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

  const cached = existsSync(BUN_CACHE)
  if (cached) {
    log("info", "main plugin already in bun cache; shim is a no-op")
    return {}
  }

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

export default ShimPlugin
