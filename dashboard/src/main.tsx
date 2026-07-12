import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import "./index.css"
import App from "./App"
import { WsProvider } from "./hooks/useWebSocket"
import ProjectsPage from "./pages/ProjectsPage"
import ProjectDetailPage from "./pages/ProjectDetailPage"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/project/:id" element={<ProjectDetailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WsProvider>
  </StrictMode>,
)