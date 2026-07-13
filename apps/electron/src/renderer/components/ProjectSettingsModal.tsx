import { useState, useEffect } from "react"
import { X, Save } from "lucide-react"
import type { Project } from "../types"

export default function ProjectSettingsModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setError("Name cannot be empty"); return }
    if (trimmed === project.name) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      const url = await window.electronAPI.invoke("get-mcp-url")
      const res = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_projects_update", args: { id: project.id, name: trimmed } }),
      })
      if (!res.ok) { setError(`Server returned ${res.status}`); setSaving(false); return }
      const data = await res.json()
      if (data.error) { setError(typeof data.error === "string" ? data.error : "Update failed"); setSaving(false); return }
      onSaved(trimmed)
      onClose()
    } catch (e: any) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={onClose}>
      <div
        className="bg-panel border border-gray-800 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-semibold">Project settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-panel2 rounded text-muted" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") save() }}
              className="w-full px-3 py-2 bg-bg border border-gray-800 rounded-lg text-text focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Path</label>
            <div className="px-3 py-2 bg-bg border border-gray-800 rounded-lg text-muted text-sm font-mono break-all">
              {project.path}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">ID</label>
              <div className="px-3 py-2 bg-bg border border-gray-800 rounded-lg text-muted text-xs font-mono break-all">
                {project.id}
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Last seen</label>
              <div className="px-3 py-2 bg-bg border border-gray-800 rounded-lg text-muted text-xs">
                {new Date(project.lastSeen).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {error ? <p className="text-bad text-sm">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-muted hover:text-text hover:bg-panel2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim() || name.trim() === project.name}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
