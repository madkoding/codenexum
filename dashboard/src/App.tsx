import { useState, useEffect } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import { useWebSocket } from "./hooks/useWebSocket"
import Sidebar from "./components/Sidebar"
import Topbar from "./components/Topbar"

export default function App() {
  const { connected } = useWebSocket()
  const location = useLocation()
  const params = useParams<{ id: string }>()
  const [drawerOpen, setDrawerOpen] = useState(false)

  let title = "Global Dashboard"
  let subtitle: string | undefined
  if (location.pathname.startsWith("/project/") && params.id) {
    title = "Project"
    subtitle = `ID: ${params.id}`
  }

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar: 240px on lg, 60px on md */}
      <aside className="hidden md:block w-16 lg:w-60 shrink-0 bg-panel border-r border-gray-800 shadow-sidebar overflow-hidden">
        <Sidebar />
      </aside>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-60 bg-panel border-r border-gray-800 shadow-sidebar animate-slide-in">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title={title} subtitle={subtitle} connected={connected} onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}