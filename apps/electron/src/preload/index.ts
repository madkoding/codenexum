import { contextBridge, ipcRenderer } from "electron"

const ALLOWED_CHANNELS = new Set([
  "get-mcp-url",
  "update:check",
  "update:download",
  "update:install",
  "update:status",
  "settings:get",
  "settings:reload-close-behavior",
  "shell:open-path",
  "shell:show-in-folder",
])

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: any[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) throw new Error(`blocked channel: ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  getMcpUrl: () => ipcRenderer.invoke("get-mcp-url"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  reloadCloseBehavior: () => ipcRenderer.invoke("settings:reload-close-behavior"),
  openPath: (p: string) => ipcRenderer.invoke("shell:open-path", p),
  showInFolder: (p: string) => ipcRenderer.invoke("shell:show-in-folder", p),
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
