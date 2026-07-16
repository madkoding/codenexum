import { useState, useEffect } from "react"

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
      getMcpUrl: () => Promise<string>
      getSettings: () => Promise<any>
      reloadCloseBehavior: () => Promise<void>
      openPath: (p: string) => Promise<boolean>
      showInFolder: (p: string) => Promise<boolean>
      update: {
        check: () => Promise<void>
        download: () => Promise<void>
        install: () => Promise<void>
        getStatus: () => Promise<any>
        onStatusChange: (fn: (snap: any) => void) => () => void
      }
    }
  }
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = async () => {
      const url = await window.electronAPI.invoke("get-mcp-url")
      if (!url) {
        reconnectTimer = setTimeout(connect, 2000)
        return
      }
      const es = new EventSource(`${url}/api/events`)
      eventSource = es

      es.onopen = () => setConnected(true)

      const forward = (kind: string) => (e: MessageEvent) => {
        try {
          window.dispatchEvent(new CustomEvent("cm-data", { detail: { kind, payload: JSON.parse(e.data) } }))
        } catch {}
      }

      es.addEventListener("usage", forward("usage"))
      es.addEventListener("project", forward("project"))
      es.addEventListener("settings", forward("settings"))

      es.onerror = () => {
        setConnected(false)
        es.close()
        eventSource = null
        reconnectTimer = setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      eventSource?.close()
    }
  }, [])

  return { connected }
}
