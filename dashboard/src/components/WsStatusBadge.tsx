import { Radio } from "lucide-react"

export default function WsStatusBadge({ connected }: { connected: boolean }) {
  const color = connected ? "bg-good" : "bg-warn"
  const text = connected ? "connected" : "connecting…"
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`relative flex h-2.5 w-2.5 ${connected ? "" : "animate-pulse"}`}>
        <span className={`absolute inline-flex h-full w-full rounded-full ${color} ${connected ? "opacity-75 animate-ping" : ""}`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
      </span>
      <span className="hidden sm:inline text-muted">{text}</span>
    </div>
  )
}