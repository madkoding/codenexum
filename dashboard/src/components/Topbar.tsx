import { Menu } from "lucide-react"
import WsStatusBadge from "./WsStatusBadge"

export default function Topbar({
  title,
  subtitle,
  connected,
  onMenuClick,
}: {
  title: string
  subtitle?: string
  connected: boolean
  onMenuClick?: () => void
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-gray-800 px-4 md:px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5 hover:bg-panel2 rounded-lg text-muted"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{title}</h1>
          {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
        </div>
      </div>
      <WsStatusBadge connected={connected} />
    </header>
  )
}