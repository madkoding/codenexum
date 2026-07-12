import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from "react"

const WS_URL = `ws://${window.location.host}/api/ws`

interface WsContextValue {
  subscribe: (channel: string, projectId?: string) => void
  unsubscribe: (channel: string) => void
  onChange: (cb: () => void) => void
  connected: boolean
}

const WsContext = createContext<WsContextValue | null>(null)

export function WsProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const closedManually = useRef(false)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subscribedChannels = useRef<Set<string>>(new Set())
  const subscribedProjectIds = useRef<Map<string, string>>(new Map())
  const changeCallbacks = useRef<Set<() => void>>(new Set())
  const [connected, setConnected] = useState(false)

  function connect() {
    closedManually.current = false
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      for (const ch of subscribedChannels.current) {
        const pid = subscribedProjectIds.current.get(ch)
        ws.send(JSON.stringify({ type: "subscribe", channel: ch, projectId: pid }))
      }
    }

    ws.onclose = () => {
      setConnected(false)
      if (!closedManually.current) {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => {}

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === "data_changed") {
          changeCallbacks.current.forEach(cb => cb())
        }
      } catch {}
    }
  }

  useEffect(() => {
    const timer = setTimeout(connect, 0)
    return () => {
      clearTimeout(timer)
      closedManually.current = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  const subscribe = useCallback((channel: string, projectId?: string) => {
    subscribedChannels.current.add(channel)
    if (projectId) subscribedProjectIds.current.set(channel, projectId)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", channel, projectId }))
    }
  }, [])

  const unsubscribe = useCallback((channel: string) => {
    subscribedChannels.current.delete(channel)
    subscribedProjectIds.current.delete(channel)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe", channel }))
    }
  }, [])

  const onChange = useCallback((cb: () => void) => {
    changeCallbacks.current.add(cb)
    return () => { changeCallbacks.current.delete(cb) }
  }, [])

  return (
    <WsContext.Provider value={{ subscribe, unsubscribe, onChange, connected }}>
      {children}
    </WsContext.Provider>
  )
}

export function useWebSocket(): WsContextValue {
  const ctx = useContext(WsContext)
  if (!ctx) throw new Error("useWebSocket must be used within WsProvider")
  return ctx
}