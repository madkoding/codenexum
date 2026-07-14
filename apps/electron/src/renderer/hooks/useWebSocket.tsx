import { useState, useEffect } from "react"

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
      getMcpUrl: () => Promise<string>
      getSettings: () => Promise<any>
      reloadCloseBehavior: () => Promise<void>
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

    window.electronAPI.invoke("get-mcp-url").then((url: string) => {
      const es = new EventSource(`${url}/api/events`)
      eventSource = es

      es.onopen = () => setConnected(true)

      es.addEventListener("usage", (e: MessageEvent) => {
        try {
          window.dispatchEvent(new CustomEvent("cm-data", { detail: JSON.parse(e.data) }))
        } catch {}
      })

      es.onerror = () => setConnected(false)
    })

    return () => eventSource?.close()
  }, [])

  return { connected }
}
