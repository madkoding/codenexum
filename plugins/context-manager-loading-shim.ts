import type { Plugin } from "@opencode-ai/plugin"

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
