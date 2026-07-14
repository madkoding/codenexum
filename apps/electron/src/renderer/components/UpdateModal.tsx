import { useState, useEffect } from "react"
import { X, Download, RefreshCw, AlertCircle, ExternalLink, CheckCircle2 } from "lucide-react"
import { useUpdateStatus } from "../hooks/useUpdateStatus"

function renderNotes(raw: string | string[] | null | undefined): string {
  if (!raw) return ""
  if (typeof raw === "string") return raw
  return raw.join("\n\n")
}

export default function UpdateModal() {
  const { status, progress, info, error, currentVersion, check, download, install } = useUpdateStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (status === "available" || status === "downloaded" || status === "unsupported") {
      setDismissed(null)
    }
  }, [status, info?.version])

  if (status === "idle" || status === "checking" || status === "disabled" || status === "not-available") return null
  if (status === "error" && dismissed === error) return null
  if (status === "available" && dismissed === "available:" + info?.version) return null
  if (status === "unsupported" && dismissed === "unsupported:" + info?.version) return null
  if (status === "downloading" && dismissed === "downloading:" + info?.version) return null

  const dismiss = (key: string) => setDismissed(key)

  if (status === "downloading") {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]">
        <div className="bg-panel border border-gray-800 rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Download size={16} className="text-accent shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">Downloading v{info?.version}</p>
                <p className="text-xs text-muted">{progress}%</p>
              </div>
            </div>
            <button
              onClick={() => dismiss("downloading:" + info?.version)}
              className="p-1 hover:bg-panel2 rounded text-muted shrink-0"
              aria-label="Hide"
            >
              <X size={14} />
            </button>
          </div>
          <div className="h-1.5 bg-bg rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]">
        <div className="bg-panel border border-gray-800 rounded-xl shadow-2xl p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={16} className="text-bad shrink-0" />
              <p className="text-sm font-medium">Update check failed</p>
            </div>
            <button
              onClick={() => dismiss(error || "error")}
              className="p-1 hover:bg-panel2 rounded text-muted shrink-0"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-muted break-words">{error}</p>
          <button
            onClick={check}
            className="text-xs text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (status === "unsupported") {
    return (
      <Modal title={`CodeNexum v${info?.version} available`} onClose={() => dismiss("unsupported:" + info?.version)}>
        <p className="text-sm text-muted">
          Your current install format doesn't support auto-update on this platform. Download the new version manually:
        </p>
        <a
          href="https://github.com/madKoding/codenexum/releases/latest"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
        >
          Open release page <ExternalLink size={12} />
        </a>
        <div className="flex justify-end pt-2">
          <button
            onClick={() => dismiss("unsupported:" + info?.version)}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:opacity-90"
          >
            OK
          </button>
        </div>
      </Modal>
    )
  }

  if (status === "available") {
    return (
      <Modal title={`CodeNexum v${info?.version} available`} onClose={() => dismiss("available:" + info?.version)}>
        <p className="text-sm text-muted">
          You're running v{currentVersion}. A new version is ready to download.
        </p>
        {info?.releaseNotes ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-text">Release notes</summary>
            <pre className="mt-2 p-3 bg-bg border border-gray-800 rounded-lg max-h-48 overflow-y-auto scrollbar-thin whitespace-pre-wrap font-sans">
              {renderNotes(info.releaseNotes)}
            </pre>
          </details>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => dismiss("available:" + info?.version)}
            className="px-4 py-2 text-sm text-muted hover:text-text hover:bg-panel2 rounded-lg"
          >
            Later
          </button>
          <button
            onClick={download}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:opacity-90 flex items-center gap-1.5"
          >
            <Download size={14} />
            Download
          </button>
        </div>
      </Modal>
    )
  }

  if (status === "downloaded") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
        <div className="bg-panel border border-gray-800 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
          <h2 className="text-lg font-semibold">Restart to install v{info?.version}</h2>
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className="text-accent mt-0.5 shrink-0" />
            <p className="text-sm text-muted">
              The update is downloaded and ready. Restart CodeNexum to apply it.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={install}
              className="px-4 py-2 text-sm text-muted hover:text-text hover:bg-panel2 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw size={14} />
              On next quit
            </button>
            <button
              onClick={install}
              className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:opacity-90"
            >
              Restart now
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-panel border border-gray-800 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-panel2 rounded text-muted" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
