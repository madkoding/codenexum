import { contextBridge, ipcRenderer } from "electron"

const ALLOWED_CHANNELS = new Set([
  "get-mcp-url",
  "update:check",
  "update:download",
  "update:install",
  "update:status",
])

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: any[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) throw new Error(`blocked channel: ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  getMcpUrl: () => ipcRenderer.invoke("get-mcp-url"),
  update: {
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    getStatus: () => ipcRenderer.invoke("update:status"),
    onStatusChange: (fn: (snap: any) => void) => {
      const handler = (_: unknown, snap: unknown) => fn(snap)
      ipcRenderer.on("update:status-changed", handler)
      return () => ipcRenderer.off("update:status-changed", handler)
    },
  },
})
