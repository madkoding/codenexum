import { useEffect, useState, useCallback, type ComponentType } from "react"
import { useParams } from "react-router-dom"
import { Card, LoadingScreen } from "../components/ui"
import { fmt, fmtK, pct, relTime } from "../lib/format"
import type { ProjectStats, AggregateData } from "../types"
import {
  Zap, Target, FileText, Cpu,
  Search, Sparkles, Database, Minimize2, Brain,
  Activity, PiggyBank, BarChart3,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip,
} from "recharts"

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b92a8", "#ec4899", "#a78bfa", "#06b6d4", "#84cc16"]

const TYPE_BADGES: Record<string, { bg: string; Icon: ComponentType<{ size?: number }> }> = {
  search: { bg: "bg-blue-500/15 text-blue-300", Icon: Search },
  search_savings: { bg: "bg-cyan-500/15 text-cyan-300", Icon: Sparkles },
  index_substitute: { bg: "bg-green-500/15 text-green-300", Icon: Zap },
  file_read: { bg: "bg-violet-500/15 text-violet-300", Icon: FileText },
  cache_hit: { bg: "bg-amber-500/15 text-amber-300", Icon: Database },
  compression: { bg: "bg-orange-500/15 text-orange-300", Icon: Minimize2 },
  semantic_compression: { bg: "bg-pink-500/15 text-pink-300", Icon: Brain },
  turn_savings: { bg: "bg-emerald-500/15 text-emerald-300", Icon: PiggyBank },
}

const SAVINGS_COLORS: Record<string, string> = {
  indexSubstitution: "#3b82f6",
  searchSnippets: "#22c55e",
  compression: "#f59e0b",
  semanticCompression: "#ec4899",
  cacheHit: "#06b6d4",
  generativeCompression: "#84cc16",
  outputCompression: "#f97316",
}

function HeroMetric({ value, label, sub, accent, Icon }: { value: string; label: string; sub?: string; accent: string; Icon: ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-gray-800 bg-gradient-to-br ${accent} p-4`}>
      <div className="absolute -right-3 -top-3 text-white/10">
        <Icon size={88} />
      </div>
      <div className="relative">
        <div className="text-3xl font-bold tracking-tight text-white tabular-nums">{value}</div>
        <div className="text-sm text-white/80 mt-1">{label}</div>
        {sub ? <div className="text-xs text-white/60 mt-2">{sub}</div> : null}
      </div>
    </div>
  )
}

function ProgressList({ data, format, color }: { data: { name: string; count: number }[]; format?: (n: number) => string; color?: string }) {
  if (data.length === 0) return <p className="text-muted text-sm py-8 text-center">No data yet</p>
  const max = data[0].count || 1
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const c = color || COLORS[i % COLORS.length]
        return (
          <div key={d.name}>
            <div className="flex items-center justify-between text-sm mb-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                <span className="text-zinc-300 capitalize truncate max-w-[160px]" title={d.name}>{d.name}</span>
              </div>
              <span className="tabular-nums text-muted">{(format || fmt)(d.count)}</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(d.count / max) * 100}%`, background: c }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SavingsMechanismChart({ data }: { data: { key: string; label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return (
    <div className="h-56 flex flex-col items-center justify-center text-center">
      <Sparkles size={36} className="text-muted/40 mb-2" />
      <p className="text-muted text-sm">No savings recorded yet</p>
      <p className="text-muted/60 text-xs mt-1">Use <code className="text-accent">context_search</code> to start saving</p>
    </div>
  )
  return (
    <div className="flex items-center gap-4 h-56">
      <div className="h-full w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="90%" paddingAngle={2} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }} formatter={(v: any) => fmtK(v as number)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2">
        {data.filter(d => d.value > 0).sort((a, b) => b.value - a.value).map((d) => {
          const share = total > 0 ? d.value / total : 0
          return (
            <div key={d.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  <span className="text-zinc-300">{d.label}</span>
                </div>
                <span className="text-muted tabular-nums">{fmtK(d.value)} <span className="text-zinc-500">({(share * 100).toFixed(0)}%)</span></span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: d.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniRing({ value, max, label, color = "#3b82f6", size = 64 }: { value: number; max: number; label: string; color?: string; size?: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - pct)
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="-mt-10 text-xs font-semibold text-text tabular-nums" style={{ color }}>{pct > 0 ? `${(pct * 100).toFixed(0)}%` : "—"}</div>
      <div className="text-[10px] text-muted mt-1 text-center leading-tight">{label}</div>
    </div>
  )
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [agg, setAgg] = useState<AggregateData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    if (!id) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8_000)
    try {
      const url = await window.electronAPI.invoke("get-mcp-url")
      if (!url) { setError("MCP server URL not available"); return }
      const pRes = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_projects_get", args: { id } }),
        signal: ctrl.signal,
      })
      if (!pRes.ok) { setError(`Server returned ${pRes.status}`); return }
      const pData = await pRes.json()
      if (pData.error) { setError(pData.error); return }
      const project = pData.result || pData
      if (project?.path) {
        const [sRes, aRes] = await Promise.all([
          fetch(`${url}/tools/call`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: "cm_stats", args: { projectDir: project.path } }),
            signal: ctrl.signal,
          }),
          fetch(`${url}/tools/call`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: "cm_aggregate", args: { projectDir: project.path } }),
            signal: ctrl.signal,
          }),
        ])
        if (sRes.ok) {
          const sData = await sRes.json()
          setStats(sData.result || sData.stats || null)
        }
        if (aRes.ok) {
          const aData = await aRes.json()
          setAgg(aData.result || aData.aggregate || null)
        }
      }
      setError(null)
    } catch (e: any) {
      if (e?.name === "AbortError") setError("Request timed out (8s)")
      else setError(String(e?.message || e))
    } finally {
      clearTimeout(timer)
    }
  }, [id])

  useEffect(() => {
    fetchStats()
    const handler = () => fetchStats()
    window.addEventListener("cm-data", handler)
    return () => window.removeEventListener("cm-data", handler)
  }, [fetchStats, id])

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-bad">Error: {error}</p>
        <button onClick={fetchStats} className="px-4 py-2 bg-accent text-white rounded-lg text-sm">Retry</button>
      </div>
    )
  }

  if (!stats) {
    return <LoadingScreen message="Loading project…" />
  }

  const topFiles = stats.topFiles || []
  const recentEvents = stats.recentEvents || []
  const languages = stats.languages || []
  const savings = stats.savingsByMechanism || {}

  const savingsData = [
    { key: "indexSubstitution", label: "Index substitution", value: savings.indexSubstitution || 0, color: SAVINGS_COLORS.indexSubstitution },
    { key: "searchSnippets", label: "Search snippets", value: savings.searchSnippets || 0, color: SAVINGS_COLORS.searchSnippets },
    { key: "compression", label: "Compression", value: savings.compression || 0, color: SAVINGS_COLORS.compression },
    { key: "semanticCompression", label: "Semantic compression", value: savings.semanticCompression || 0, color: SAVINGS_COLORS.semanticCompression },
    { key: "cacheHit", label: "Cache hits", value: savings.cacheHit || 0, color: SAVINGS_COLORS.cacheHit },
  ]

  const typeData = agg?.byType
    ? Object.entries(agg.byType).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6)
    : []
  const langData = agg?.byLang
    ? Object.entries(agg.byLang).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6)
    : languages.map((l: any) => ({ name: l.name, count: l.count })).slice(0, 6)

  const topFilesChart = topFiles.slice(0, 8).map(f => {
    const fname = f.path.split("/").pop() || f.path
    return {
      name: fname.length > 28 ? fname.slice(0, 28) + "…" : fname,
      full: f.path,
      count: f.count,
    }
  })

  const isInactive = (stats.measuredSavings || 0) === 0 && (stats.efficiencyRatio || 0) === 0
  const nativeSearches = stats.nativeSearches || 0
  const searches = stats.searches || 0
  const lastTs = stats.indexedAt ? new Date(stats.indexedAt).getTime() : 0
  const ageHours = lastTs ? (Date.now() - lastTs) / (1000 * 60 * 60) : Infinity
  const freshness = ageHours < 1 ? 1 : ageHours < 24 ? 0.8 : ageHours < 168 ? 0.5 : 0.2

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-3 md:space-y-4">
      <div className="grid grid-cols-2 xs:grid-cols-4 lg:grid-cols-4 gap-3">
        {isInactive ? (
          <>
            <div className="col-span-2 relative overflow-hidden rounded-xl border border-dashed border-gray-700 bg-gradient-to-br from-zinc-800/40 to-zinc-900/40 p-4 flex flex-col items-center justify-center">
              <BarChart3 size={28} className="text-muted/40 mb-1.5" />
              <p className="text-sm font-medium text-zinc-400">Awaiting usage data</p>
              <p className="text-xs text-muted/60 mt-1 text-center">Savings and intercept metrics will appear once this project is used with opencode</p>
            </div>
            <HeroMetric
              value={fmt(stats.filesRead || 0)}
              label="Files read"
              sub={`${fmt(stats.snippetOnly || 0)} snippet substitutions`}
              accent="from-cyan-600/40 to-cyan-900/40"
              Icon={FileText}
            />
            <HeroMetric
              value={fmt(stats.chunks || 0)}
              label="Indexed chunks"
              sub={`${fmt(stats.files || 0)} files · ${fmt(stats.edges || 0)} edges`}
              accent="from-amber-600/40 to-amber-900/40"
              Icon={Cpu}
            />
          </>
        ) : (
          <>
            <HeroMetric
              value={fmtK(stats.measuredSavings || 0)}
              label="Tokens saved"
              sub={`${fmt(stats.indexSubstitutions || 0)} substitutions`}
              accent="from-blue-600/40 to-blue-900/40"
              Icon={Zap}
            />
            <HeroMetric
              value={pct(stats.efficiencyRatio || 0)}
              label="Intercept rate"
              sub={`${fmt(searches)} searches · ${fmt(nativeSearches)} native`}
              accent="from-violet-600/40 to-violet-900/40"
              Icon={Target}
            />
            <HeroMetric
              value={fmt(stats.filesRead || 0)}
              label="Files read"
              sub={`${fmt(stats.snippetOnly || 0)} snippet substitutions`}
              accent="from-cyan-600/40 to-cyan-900/40"
              Icon={FileText}
            />
            <HeroMetric
              value={fmt(stats.chunks || 0)}
              label="Indexed chunks"
              sub={`${fmt(stats.files || 0)} files · ${fmt(stats.edges || 0)} edges`}
              accent="from-amber-600/40 to-amber-900/40"
              Icon={Cpu}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Savings by mechanism">
          <SavingsMechanismChart data={savingsData} />
        </Card>

        <Card title="Top files (by chunk count)">
          {topFilesChart.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topFilesChart} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#8b92a8", fontSize: 10 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fill: "#8b92a8", fontSize: 10 }} width={140} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }}
                    labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.full || ""}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center">
              <FileText size={36} className="text-muted/40 mb-2" />
              <p className="text-muted text-sm">No files indexed yet</p>
            </div>
          )}
        </Card>
      </div>

      {(typeData.length > 0 || langData.length > 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {typeData.length > 0 ? (
            <Card title="Chunk types">
              <ProgressList data={typeData} color="#3b82f6" />
            </Card>
          ) : null}
          {langData.length > 0 ? (
            <Card title="Languages">
              <ProgressList data={langData} color="#22c55e" />
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card title="Index health">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <div className="flex flex-col items-center p-3 rounded-lg bg-bg/50 border border-gray-800/50">
            <MiniRing value={stats.files || 0} max={Math.max(stats.files || 0, 1)} label="Files" color="#3b82f6" />
            <div className="text-lg font-bold tabular-nums mt-2">{fmt(stats.files || 0)}</div>
            <div className="text-[10px] text-muted">indexed</div>
          </div>
          <div className="flex flex-col items-center p-3 rounded-lg bg-bg/50 border border-gray-800/50">
            <MiniRing value={stats.chunks || 0} max={Math.max(stats.chunks || 0, 1)} label="Chunks" color="#22c55e" />
            <div className="text-lg font-bold tabular-nums mt-2">{fmtK(stats.chunks || 0)}</div>
            <div className="text-[10px] text-muted">total</div>
          </div>
          <div className="flex flex-col items-center p-3 rounded-lg bg-bg/50 border border-gray-800/50">
            <MiniRing value={freshness} max={1} label="Fresh" color="#06b6d4" />
            <div className="text-lg font-bold tabular-nums mt-2">{stats.indexedAt ? relTime(stats.indexedAt) : "—"}</div>
            <div className="text-[10px] text-muted">last index</div>
          </div>
        </div>
      </Card>

      <Card title="Recent activity">
        {recentEvents.length > 0 ? (
          <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-1.5">
            {recentEvents.slice().reverse().slice(0, 20).map((e: any, i: number) => {
              const meta = TYPE_BADGES[e.type] || { bg: "bg-zinc-700/40 text-zinc-300", Icon: Activity }
              const target = e.meta?.path || e.meta?.query || e.meta?.key || e.meta?.toolID || e.meta?.symbol || "—"
              return (
                <div key={i} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded-lg hover:bg-panel2/50">
                  <span className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center ${meta.bg}`}>
                    <meta.Icon size={14} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">{e.type.replace(/_/g, " ")}</span>
                    </div>
                    <div className="font-mono text-xs text-zinc-300 truncate" title={target}>{target}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {e.tokensSaved > 0 ? (
                      <div className="text-green-400 text-sm font-semibold tabular-nums">+{fmtK(e.tokensSaved)}</div>
                    ) : null}
                    <div className="text-muted/60 text-[10px]">{e.ts ? relTime(e.ts) : ""}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Activity size={36} className="text-muted/40 mx-auto mb-2" />
            <p className="text-muted text-sm">No activity yet</p>
            <p className="text-muted/60 text-xs mt-1">Run a search to start tracking</p>
          </div>
        )}
      </Card>
    </div>
  )
}
