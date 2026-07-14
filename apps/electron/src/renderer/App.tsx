import { useState, useEffect, useCallback } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import { Menu } from "lucide-react"
import { useWebSocket } from "./hooks/useWebSocket"
import Sidebar from "./components/Sidebar"
import Topbar from "./components/Topbar"
import ProjectSettingsModal from "./components/ProjectSettingsModal"
import UpdateModal from "./components/UpdateModal"
import type { Project } from "./types"

export default function App() {
  useWebSocket()
  const location = useLocation()
  const params = useParams<{ id: string }>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsProject, setSettingsProject] = useState<Project | null>(null)
  const [project, setProject] = useState<Project | null>(null)

  const isProjectPage = location.pathname.startsWith("/project/") && !!params.id
  const showTopbar = isProjectPage
  const isHomeOrSettings = !isProjectPage
  const mobileTitle = isHomeOrSettings ? "CodeNexum" : project?.name

  const fetchProject = useCallback(async (id: string) => {
    try {
      const url = await window.electronAPI.invoke("get-mcp-url")
      const res = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_projects_get", args: { id } }),
      })
      if (!res.ok) return
      const data = await res.json()
      const p = data.result || data
      if (p?.id) setProject(p)
    } catch {}
  }, [])

  useEffect(() => {
    setDrawerOpen(false)
    setSettingsProject(null)
    if (params.id) {
      fetchProject(params.id)
    } else {
      setProject(null)
    }
  }, [location.pathname, params.id, fetchProject])

  useEffect(() => {
    const handler = () => {
      if (params.id) fetchProject(params.id)
    }
    window.addEventListener("cm-data", handler)
    return () => window.removeEventListener("cm-data", handler)
  }, [params.id, fetchProject])

  const openSettings = async () => {
    if (!params.id) return
    const url = await window.electronAPI.invoke("get-mcp-url")
    const res = await fetch(`${url}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "cm_projects_get", args: { id: params.id } }),
    })
    if (!res.ok) return
    const data = await res.json()
    const project = data.result || data
    if (project?.id) setSettingsProject(project)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside
        className={`${drawerOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 transition-transform fixed md:relative z-40 md:z-auto w-60 md:w-52 shrink-0 bg-panel border-r border-gray-800 shadow-sidebar overflow-hidden h-full`}
      >
        <Sidebar onNavigate={() => setDrawerOpen(false)} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {showTopbar ? (
          <Topbar
            title={project?.name}
            subtitle={isProjectPage ? project?.path : undefined}
            onMenuClick={() => setDrawerOpen(true)}
            onSettingsClick={openSettings}
          />
        ) : null}
        {isHomeOrSettings ? (
          <header className="md:hidden sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-gray-800 px-3 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 hover:bg-panel2 rounded-lg text-muted"
                aria-label="Toggle sidebar"
              >
                <Menu size={20} />
              </button>
              <h1 className="text-base font-semibold truncate">{mobileTitle}</h1>
            </div>
          </header>
        ) : null}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="px-3 sm:px-4 md:px-6 py-3 md:py-4">
            <Outlet />
          </div>
        </main>
      </div>

      {settingsProject ? (
        <ProjectSettingsModal
          project={settingsProject}
          onClose={() => setSettingsProject(null)}
          onSaved={() => window.dispatchEvent(new CustomEvent("cm-data"))}
        />
      ) : null}

      <UpdateModal />
    </div>
  )
}
