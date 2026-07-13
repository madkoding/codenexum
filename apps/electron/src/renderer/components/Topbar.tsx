import { Menu, Settings } from "lucide-react"

export default function Topbar({
  title,
  subtitle,
  onMenuClick,
  onSettingsClick,
}: {
  title?: string
  subtitle?: string
  onMenuClick?: () => void
  onSettingsClick?: () => void
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-gray-800 px-3 sm:px-4 md:px-6 py-2.5 md:py-3 flex items-center justify-between">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onMenuClick ? (
          <button
            onClick={onMenuClick}
            className="p-1.5 hover:bg-panel2 rounded-lg text-muted"
            aria-label="Toggle sidebar"
          >
            <Menu size={20} />
          </button>
        ) : null}
        {title ? <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1> : null}
        {subtitle ? <span className="text-xs sm:text-sm text-muted hidden sm:inline truncate">{subtitle}</span> : null}
      </div>
      {onSettingsClick ? (
        <button
          onClick={onSettingsClick}
          className="p-1.5 hover:bg-panel2 rounded-lg text-muted hover:text-text transition-colors"
          aria-label="Project settings"
          title="Project settings"
        >
          <Settings size={18} />
        </button>
      ) : null}
    </header>
  )
}
