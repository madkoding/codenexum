import { useEffect, useState, useCallback } from "react"
import { Link, useLocation } from "react-router-dom"
import { LayoutDashboard, FolderGit2, Activity } from "lucide-react"
import { useWebSocket } from "../hooks/useWebSocket"
import type { ProjectSummary } from "../types"
import { fmt } from "../lib/format"

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { subscribe, onChange, connected } = useWebSocket()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const location = useLocation()

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects")
      if (!res.ok) return
      setProjects(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    subscribe("projects")
    onChange(fetchProjects)
    fetchProjects()
  }, [subscribe, onChange, fetchProjects])

  const isActive = (path: string) => location.pathname === path

  return (
    <nav className="h-full flex flex-col">
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-2 border-b border-gray-800">
        <Activity size={20} className="text-accent shrink-0" />
        <span className="font-bold text-sm">Context Manager</span>
      </div>

      {/* Global Dashboard */}
      <div className="px-2 py-3">
        <Link
          to="/"
          onClick={onNavigate}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            isActive("/") ? "bg-accent/15 text-accent" : "text-muted hover:text-text hover:bg-panel2"
          }`}
        >
          <LayoutDashboard size={18} className="shrink-0" />
          <span>Global Dashboard</span>
        </Link>
      </div>

      <div className="px-4 py-1">
        <span className="text-xs text-muted/60 uppercase tracking-wider">Projects</span>
      </div>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-4">
        {projects.length === 0 ? (
          <p className="text-muted text-xs px-3 py-2">No projects yet</p>
        ) : (
          projects.map((p) => {
            const active = isActive(`/project/${p.id}`)
            return (
              <Link
                key={p.id}
                to={`/project/${p.id}`}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                  active ? "bg-accent/15 text-accent" : "text-muted hover:text-text hover:bg-panel2"
                }`}
              >
                <FolderGit2 size={18} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name}</div>
                  <div className="text-xs text-muted/60">{fmt(p.chunks)} chunks</div>
                </div>
              </Link>
            )
          })
        )}
      </div>

      {/* WS status footer */}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2 text-xs">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-good animate-pulse" : "bg-warn"}`} />
        <span className="text-muted">{connected ? "WS connected" : "reconnecting…"}</span>
      </div>
    </nav>
  )
}