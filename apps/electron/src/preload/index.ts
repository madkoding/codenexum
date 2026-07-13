import { contextBridge, ipcRenderer } from "electron"

const ALLOWED_CHANNELS = new Set(["get-mcp-url"])

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, ...args: any[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) throw new Error(`blocked channel: ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  getMcpUrl: () => ipcRenderer.invoke("get-mcp-url"),
})
