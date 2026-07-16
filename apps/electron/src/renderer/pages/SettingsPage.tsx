import { useEffect, useState, useCallback } from "react"
import { LoadingScreen } from "../components/ui"
import {
  Settings, RotateCcw, Zap, Search, FileText, Database,
  Brain, Palette, AlignLeft, FileCode2, Save, Sparkles, AlertTriangle, Layout,
} from "lucide-react"

interface AppSettings {
  readInterception: boolean
  grepInterception: boolean
  autoCompress: boolean
  cache: boolean
  turnSavingsLog: boolean
  semanticCompression: boolean
  ansiStrip: boolean
  dedupeRuns: boolean
  stackTrim: boolean
  capBodyLines: boolean
  persistentCache: boolean
  closeToTray: boolean
  autoDiscover: boolean
  compressThreshold: number
  cacheTtlMs: number
  cacheMaxEntries: number
}

const DEFAULTS: AppSettings = {
  readInterception: true,
  grepInterception: true,
  autoCompress: true,
  cache: true,
  turnSavingsLog: true,
  semanticCompression: true,
  ansiStrip: true,
  dedupeRuns: true,
  stackTrim: true,
  capBodyLines: true,
  persistentCache: true,
  closeToTray: false,
  autoDiscover: true,
  compressThreshold: 8000,
  cacheTtlMs: 5 * 60 * 1000,
  cacheMaxEntries: 200,
}

interface ToggleDef {
  key: keyof AppSettings
  label: string
  description: string
  Icon: React.ComponentType<{ size?: number; className?: string }>
  category: "intercept" | "compress" | "cache" | "telemetry" | "window"
}

const TOGGLES: ToggleDef[] = [
  {
    key: "readInterception",
    label: "Read interception",
    description: "When the agent runs a `read` (or `cat`/`head`/`tail`), replace the full file output with a compact snippet of the indexed symbols. Big savings on large files.",
    Icon: FileText,
    category: "intercept",
  },
  {
    key: "grepInterception",
    label: "Grep interception",
    description: "When the agent runs a `grep` or `glob`, replace the raw output with a search through the code index. Faster results, much smaller payload.",
    Icon: Search,
    category: "intercept",
  },
  {
    key: "autoCompress",
    label: "Auto-compress large outputs",
    description: "Any tool output longer than the threshold (default 8K chars) is automatically compressed before being shown to the model.",
    Icon: AlignLeft,
    category: "compress",
  },
  {
    key: "semanticCompression",
    label: "Semantic compression",
    description: "For test/build output, extract just the summary (e.g. \"8 passed, 3 failed\") instead of the full log. Massive savings on CI runs.",
    Icon: Sparkles,
    category: "compress",
  },
  {
    key: "ansiStrip",
    label: "Strip ANSI color codes",
    description: "Remove terminal color escape sequences (e.g. \\x1b[32m) from tool outputs. The model doesn't need colors and they cost tokens.",
    Icon: Palette,
    category: "compress",
  },
  {
    key: "dedupeRuns",
    label: "Collapse repeated lines",
    description: "When a tool prints the same line many times in a row (e.g. \"Compiling foo...\" x 20), collapse it to \"Compiling foo... (x20)\".",
    Icon: FileCode2,
    category: "compress",
  },
  {
    key: "stackTrim",
    label: "Trim stack trace indent",
    description: "Strip leading whitespace from stack frame lines, since the file paths are usually self-explanatory.",
    Icon: Brain,
    category: "compress",
  },
  {
    key: "capBodyLines",
    label: "Cap code snippet body lines",
    description: "When showing indexed code chunks in `read`/`grep` output, limit each chunk body to 15 lines so functions don't blow up the context.",
    Icon: AlertTriangle,
    category: "compress",
  },
  {
    key: "cache",
    label: "Cache snippets in memory",
    description: "Within a single session, repeated `read`/`grep` of the same file/pattern uses the in-memory cache instead of re-querying.",
    Icon: Database,
    category: "cache",
  },
  {
    key: "persistentCache",
    label: "Persist cache across sessions",
    description: "Save the snippet cache to disk so it survives opencode restarts. File mtimes are checked — stale entries are auto-invalidated.",
    Icon: Save,
    category: "cache",
  },
  {
    key: "turnSavingsLog",
    label: "Track savings per turn",
    description: "Log a `turn_savings` event at the end of each session.idle with the cumulative token savings, visible in the dashboard.",
    Icon: Zap,
    category: "telemetry",
  },
  {
    key: "autoDiscover",
    label: "Auto-discover sibling projects",
    description: "When indexing a project, also scan its parent directory and index any sibling projects (heuristic via .git / package.json / Cargo.toml / etc.). Disable if you only want to track the project you explicitly point at.",
    Icon: Search,
    category: "intercept",
  },
  {
    key: "closeToTray",
    label: "Close to tray",
    description: "When enabled, closing the window hides the app to the system tray instead of quitting. The MCP server keeps running in the background. Right-click the tray icon to quit.",
    Icon: Layout,
    category: "window",
  },
]

const CATEGORIES: { id: ToggleDef["category"]; label: string; description: string }[] = [
  { id: "intercept", label: "Interception", description: "Replace native tool outputs with index-based snippets." },
  { id: "compress", label: "Compression", description: "Reduce the size of any tool output before it reaches the LLM." },
  { id: "cache", label: "Cache", description: "Avoid re-fetching the same snippet multiple times." },
  { id: "telemetry", label: "Telemetry", description: "What gets logged and shown in the dashboard." },
  { id: "window", label: "Window", description: "How the app window behaves on close and minimize." },
]

function Toggle({ def, value, onChange, saving }: { def: ToggleDef; value: boolean; onChange: (v: boolean) => void; saving: boolean }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-800 bg-bg/50 hover:border-gray-700 transition-colors">
      <button
        onClick={() => onChange(!value)}
        disabled={saving}
        aria-label={`Toggle ${def.label}`}
        className={`relative w-10 h-5 shrink-0 mt-0.5 rounded-full transition-colors disabled:opacity-50 ${value ? "bg-accent" : "bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${value ? "left-5" : "left-0.5"}`} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <def.Icon size={14} className={value ? "text-accent" : "text-muted/60"} />
          <div className="text-sm font-medium text-text">{def.label}</div>
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${value ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-muted/60"}`}>
            {value ? "on" : "off"}
          </span>
        </div>
        <div className="text-xs text-muted mt-1 leading-relaxed">{def.description}</div>
      </div>
    </div>
  )
}

function NumberField({ label, description, value, suffix, onChange, saving, min, max }: { label: string; description: string; value: number; suffix?: string; onChange: (v: number) => void; saving: boolean; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-800 bg-bg/50">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="text-xs text-muted mt-1 leading-relaxed">{description}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          disabled={saving}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="w-20 px-2 py-1 text-sm bg-panel border border-gray-800 rounded text-right tabular-nums focus:outline-none focus:border-accent"
        />
        {suffix ? <span className="text-xs text-muted">{suffix}</span> : null}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8_000)
    try {
      const url = await window.electronAPI.getMcpUrl()
      if (!url) return
      const res = await fetch(`${url}/api/settings`, { signal: ctrl.signal })
      if (!res.ok) return
      const data = await res.json()
      setSettings({ ...DEFAULTS, ...data })
    } catch {} finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  useEffect(() => {
    const handler = (e: any) => {
      const detail = e?.detail
      if (detail && typeof detail === "object" && "readInterception" in detail) {
        setSettings({ ...DEFAULTS, ...detail })
      }
    }
    window.addEventListener("cm-data", handler)
    return () => window.removeEventListener("cm-data", handler)
  }, [])

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSaving(true)
    try {
      const next = { ...settings, ...patch }
      setSettings(next)
      const url = await window.electronAPI.getMcpUrl()
      await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_settings_set", args: { settings: patch } }),
      })
      if ("closeToTray" in patch) {
        await window.electronAPI.reloadCloseBehavior()
      }
    } catch {} finally {
      setSaving(false)
    }
  }, [settings])

  const reset = useCallback(async () => {
    if (!confirm("Reset all settings to defaults?")) return
    setSaving(true)
    try {
      setSettings(DEFAULTS)
      const url = await window.electronAPI.getMcpUrl()
      await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_settings_set", args: { settings: DEFAULTS } }),
      })
    } catch {} finally {
      setSaving(false)
    }
  }, [])

  if (loading) {
    return <LoadingScreen message="Loading settings…" />
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-accent" />
            <h1 className="text-2xl font-bold">Settings</h1>
          </div>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Configure what CodeNexum intercepts, compresses, and caches. Each feature is described below.
            Changes take effect immediately for new tool calls.
          </p>
        </div>
        <button
          onClick={reset}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-text border border-gray-800 hover:border-gray-700 rounded-lg disabled:opacity-50"
        >
          <RotateCcw size={12} />
          Reset to defaults
        </button>
      </div>

      {CATEGORIES.map(cat => {
        const catToggles = TOGGLES.filter(t => t.category === cat.id)
        if (catToggles.length === 0) return null
        return (
          <section key={cat.id}>
            <div className="mb-2">
              <h2 className="text-xs uppercase tracking-wider text-muted">{cat.label}</h2>
              <p className="text-xs text-muted/60 mt-0.5">{cat.description}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {catToggles.map(def => (
                <Toggle
                  key={def.key}
                  def={def}
                  value={settings[def.key] as boolean}
                  onChange={(v) => update({ [def.key]: v } as Partial<AppSettings>)}
                  saving={saving}
                />
              ))}
            </div>
          </section>
        )
      })}

      <section>
        <div className="mb-2">
          <h2 className="text-xs uppercase tracking-wider text-muted">Tuning</h2>
          <p className="text-xs text-muted/60 mt-0.5">Numerical limits for the features above.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <NumberField
            label="Compress threshold"
            description="Auto-compress tool outputs longer than this many characters."
            value={settings.compressThreshold}
            suffix="chars"
            onChange={(v) => update({ compressThreshold: v })}
            saving={saving}
            min={1000}
            max={100000}
          />
          <NumberField
            label="Cache TTL"
            description="How long a cached snippet stays valid (ms). File mtime is also checked."
            value={settings.cacheTtlMs}
            suffix="ms"
            onChange={(v) => update({ cacheTtlMs: v })}
            saving={saving}
            min={10000}
          />
          <NumberField
            label="Cache max entries"
            description="Maximum number of cached snippets in memory at once."
            value={settings.cacheMaxEntries}
            onChange={(v) => update({ cacheMaxEntries: v })}
            saving={saving}
            min={10}
            max={10000}
          />
        </div>
      </section>

      {saving ? (
        <div className="text-xs text-muted/60 text-right">Saving...</div>
      ) : null}
    </div>
  )
}
