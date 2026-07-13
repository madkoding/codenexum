import { useEffect, useState, useCallback, type ComponentType } from "react"
import { Link } from "react-router-dom"
import { Card, EmptyState, LoadingScreen } from "../components/ui"
import { fmt, fmtK, pct, relTime } from "../lib/format"
import {
  BarChart3, Zap, Target, FolderGit2,
  Search, Sparkles, FileText, Database, Minimize2, Brain,
  TrendingUp, Clock, Activity, PiggyBank,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Tooltip,
} from "recharts"

interface Project {
  id: string
  path: string
  name: string
  dbPath: string
  lastSeen: string
}

interface AggregateData {
  byType: Record<string, number>
  byLang: Record<string, number>
  topFiles: { path: string; count: number }[]
}

interface ProjectSummary extends Project {
  chunks: number
  files: number
  edges: number
  measuredSavings?: number
  searches?: number
  efficiencyRatio?: number
}

interface AnalyticsData {
  activityTimeline: { hour: string; count: number; saved: number }[]
  cumulativeSavings: { ts: string; total: number }[]
  topQueries: { query: string; count: number; saved: number }[]
  recentActivity: { type: string; target: string; tokensSaved: number; ts: string; project: string }[]
  indexHealth: { id: string; name: string; path: string; lastIndexed: string | null; chunks: number; files: number; zeroChunkFiles: number }[]
  hotFiles: { path: string; count: number; project: string; chunks: number }[]
}

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b92a8", "#ec4899", "#a78bfa", "#06b6d4", "#84cc16"]
const SAVINGS_COLORS: Record<string, string> = {
  indexSubstitution: "#3b82f6",
  searchSnippets: "#22c55e",
  compression: "#f59e0b",
  cacheHit: "#06b6d4",
  semanticCompression: "#ec4899",
}

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

function MiniRing({ value, max, label, color = "#3b82f6", size = 56 }: { value: number; max: number; label: string; color?: string; size?: number }) {
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
      <div className="-mt-9 text-xs font-semibold text-text tabular-nums" style={{ color }}>{pct > 0 ? `${(pct * 100).toFixed(0)}%` : "—"}</div>
      <div className="text-[10px] text-muted mt-1 text-center leading-tight">{label}</div>
    </div>
  )
}

function SavingsMechanismChart({ data }: { data: { key: string; label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <p className="text-muted text-sm py-8 text-center">No savings recorded yet</p>
  return (
    <div className="flex items-center gap-4 h-56">
      <div className="h-full w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }}
              formatter={(v: any) => fmtK(v as number)}
            />
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

function ProjectHealthCard({ name, files, chunks, zeroChunkFiles, lastIndexed, href, accent }: { name: string; files: number; chunks: number; zeroChunkFiles: number; lastIndexed: string | null; href: string; accent: string }) {
  const indexedRatio = files > 0 ? 1 - (zeroChunkFiles / files) : 0
  const lastTs = lastIndexed ? new Date(lastIndexed).getTime() : 0
  const ageHours = lastTs ? (Date.now() - lastTs) / (1000 * 60 * 60) : Infinity
  const freshness = ageHours < 1 ? 1 : ageHours < 24 ? 0.8 : ageHours < 168 ? 0.5 : 0.2
  return (
    <Link to={href} className="block bg-panel border border-gray-800 rounded-xl p-4 hover:border-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
            <div className="font-semibold truncate text-sm">{name}</div>
          </div>
          <div className="text-xs text-muted mt-0.5">{lastIndexed ? `Updated ${relTime(lastIndexed)}` : "Never indexed"}</div>
        </div>
      </div>
      <div className="flex items-end justify-around gap-2">
        <div className="flex flex-col items-center">
          <MiniRing value={files - zeroChunkFiles} max={files || 1} label="Indexed" color={accent} />
        </div>
        <div className="flex flex-col items-center">
          <MiniRing value={freshness} max={1} label="Fresh" color="#22c55e" />
        </div>
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums">{fmtK(chunks)}</div>
          <div className="text-[10px] text-muted">chunks</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums">{fmt(files)}</div>
          <div className="text-[10px] text-muted">files</div>
        </div>
      </div>
    </Link>
  )
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [agg, setAgg] = useState<AggregateData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 10_000)
    try {
      const url = await window.electronAPI.invoke("get-mcp-url")
      if (!url) { setError("MCP server URL not available"); setLoading(false); return }
      const [pRes, aRes, anRes, ...statsRes] = await Promise.all([
        fetch(`${url}/tools/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "cm_projects_list", args: {} }),
          signal: abort.signal,
        }),
        fetch(`${url}/tools/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "cm_aggregate", args: {} }),
          signal: abort.signal,
        }),
        fetch(`${url}/tools/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "cm_analytics", args: {} }),
          signal: abort.signal,
        }),
        fetch(`${url}/tools/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "cm_projects_list", args: {} }),
          signal: abort.signal,
        }).then(async (r) => {
          if (!r.ok) return []
          const data = await r.json()
          const list = (data.result || []) as Project[]
          return Promise.all(list.slice(0, 5).map(async (p) => {
            try {
              const sRes = await fetch(`${url}/tools/call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tool: "cm_stats", args: { projectDir: p.path } }),
                signal: abort.signal,
              })
              if (!sRes.ok) return p
              const sData = await sRes.json()
              const s = sData.result || {}
              return { ...p, chunks: s.chunks || 0, files: s.files || 0, edges: s.edges || 0, measuredSavings: s.measuredSavings || 0, searches: s.searches || 0, efficiencyRatio: s.efficiencyRatio || 0 }
            } catch { return p }
          }))
        }),
      ])
      if (!pRes.ok) { setError(`Server returned ${pRes.status}`); setLoading(false); return }
      const pData = await pRes.json()
      if (pData.error) { setError(typeof pData.error === "string" ? pData.error : pData.error.message || JSON.stringify(pData.error)); setLoading(false); return }
      const list = (pData.result || pData.projects || []) as Project[]
      const enriched = (statsRes[0] && Array.isArray(statsRes[0]) && statsRes[0].length > 0) ? statsRes[0] : list.map(p => ({ ...p, chunks: 0, files: 0, edges: 0 }))
      setProjects(enriched as ProjectSummary[])
      if (aRes.ok) {
        const aData = await aRes.json()
        setAgg(aData.result || aData.aggregate || null)
      }
      if (anRes.ok) {
        const anData = await anRes.json()
        setAnalytics(anData.result || null)
      }
      setError(null)
    } catch (e: any) {
      if (e?.name === "AbortError") setError("Request timed out (10s)")
      else setError(String(e?.message || e))
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const handler = () => fetchAll()
    window.addEventListener("cm-data", handler)
    return () => window.removeEventListener("cm-data", handler)
  }, [fetchAll])

  if (loading) {
    return <LoadingScreen message="Loading projects…" />
  }

  if (error) {
    return <div className="p-6 text-red-400">Error: {error}</div>
  }

  if (projects.length === 0) {
    return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-3 md:space-y-4">
        <Card title="Projects">
          <EmptyState
            icon={<FolderGit2 size={48} className="text-muted mx-auto" />}
            title="No projects yet"
            description="Open opencode in a project directory and use any context_* tool — the project will be registered automatically. The CodeNexum app must be running."
          />
        </Card>
      </div>
    )
  }

  const totalChunks = projects.reduce((s, p) => s + (p.chunks || 0), 0)
  const totalSavings = projects.reduce((s, p) => s + (p.measuredSavings || 0), 0)
  const avgEfficiency = projects.length > 0
    ? projects.reduce((s, p) => s + (p.efficiencyRatio || 0), 0) / projects.length
    : 0

  const activity24h = analytics?.activityTimeline.reduce((s, b) => s + b.count, 0) || 0

  const cumulativeChartData = (analytics?.cumulativeSavings || []).map((p, i, arr) => {
    const d = new Date(p.ts)
    return {
      time: i === 0 || i === arr.length - 1 || i % Math.max(1, Math.floor(arr.length / 6)) === 0
        ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
        : "",
      Tokens: p.total,
    }
  })

  const activityChartData = (analytics?.activityTimeline || []).map(b => ({
    hour: b.hour.slice(11) + "h",
    Events: b.count,
  }))

  const topQueriesChart = (analytics?.topQueries || []).slice(0, 6).map(q => ({
    name: q.query.length > 28 ? q.query.slice(0, 28) + "…" : q.query,
    full: q.query,
    Searches: q.count,
  }))

  const savingsData = analytics?.recentActivity && analytics.recentActivity.length > 0
    ? (() => {
        const idx = new Map<string, number>()
        for (const e of analytics.recentActivity) {
          if (e.tokensSaved > 0) {
            const k = e.type === "search_savings" ? "searchSnippets"
              : e.type === "index_substitute" ? "indexSubstitution"
              : e.type === "compression" || e.type === "semantic_compression" ? "compression"
              : e.type === "cache_hit" ? "cacheHit"
              : e.type === "file_read" ? "indexSubstitution"
              : null
            if (k) idx.set(k, (idx.get(k) || 0) + e.tokensSaved)
          }
        }
        return [
          { key: "indexSubstitution", label: "Index substitution", value: idx.get("indexSubstitution") || 0, color: SAVINGS_COLORS.indexSubstitution },
          { key: "searchSnippets", label: "Search snippets", value: idx.get("searchSnippets") || 0, color: SAVINGS_COLORS.searchSnippets },
          { key: "compression", label: "Compression", value: idx.get("compression") || 0, color: SAVINGS_COLORS.compression },
          { key: "cacheHit", label: "Cache hits", value: idx.get("cacheHit") || 0, color: SAVINGS_COLORS.cacheHit },
        ]
      })()
    : []

  const langData = agg?.byLang
    ? Object.entries(agg.byLang).map(([lang, count]) => ({ name: lang, value: count })).sort((a, b) => b.value - a.value).slice(0, 5)
    : []
  const typeData = agg?.byType
    ? Object.entries(agg.byType).map(([type, count]) => ({ name: type, value: count })).sort((a, b) => b.value - a.value).slice(0, 5)
    : []

  const projectAccents = ["#3b82f6", "#22c55e", "#ec4899", "#f59e0b", "#06b6d4", "#8b92a8"]
  const indexHealthRows = analytics?.indexHealth || []

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="grid grid-cols-2 xs:grid-cols-4 lg:grid-cols-4 gap-3">
        <HeroMetric
          value={fmtK(totalSavings)}
          label="Tokens saved"
          accent="from-blue-600/40 to-blue-900/40"
          Icon={Zap}
        />
        <HeroMetric
          value={fmt(activity24h)}
          label="Events (24h)"
          accent="from-green-600/40 to-green-900/40"
          Icon={BarChart3}
        />
        <HeroMetric
          value={pct(avgEfficiency)}
          label="Intercept rate"
          accent="from-violet-600/40 to-violet-900/40"
          Icon={Target}
        />
        <HeroMetric
          value={fmt(projects.length)}
          label="Active projects"
          accent="from-amber-600/40 to-amber-900/40"
          Icon={FolderGit2}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Cumulative tokens saved (24h)">
          {cumulativeChartData.length > 1 && (cumulativeChartData[cumulativeChartData.length - 1].Tokens || 0) > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="time" tick={{ fill: "#8b92a8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8b92a8", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }} formatter={(v: any) => fmtK(v as number)} />
                  <Area type="monotone" dataKey="Tokens" stroke="#22c55e" fill="url(#cumGrad)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center">
              <TrendingUp size={36} className="text-muted/40 mb-2" />
              <p className="text-muted text-sm">No savings recorded yet</p>
              <p className="text-muted/60 text-xs mt-1">Use <code className="text-accent">context_search</code> or any tool — savings accumulate automatically</p>
            </div>
          )}
        </Card>

        <Card title="Hourly activity (24h)">
          {activityChartData.some(d => d.Events > 0) ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="hour" tick={{ fill: "#8b92a8", fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fill: "#8b92a8", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }} />
                  <Bar dataKey="Events" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center">
              <Clock size={36} className="text-muted/40 mb-2" />
              <p className="text-muted text-sm">No activity in the last 24 hours</p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Frequent searches">
          {topQueriesChart.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <BarChart
                  data={topQueriesChart}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#8b92a8", fontSize: 10 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fill: "#8b92a8", fontSize: 10 }} width={180} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }}
                    labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.full || ""}
                  />
                  <Bar dataKey="Searches" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center">
              <Search size={36} className="text-muted/40 mb-2" />
              <p className="text-muted text-sm">No searches yet</p>
              <p className="text-muted/60 text-xs mt-1">Greps and <code className="text-accent">context_search</code> will appear here</p>
            </div>
          )}
        </Card>

        <Card title="Savings by mechanism">
          <SavingsMechanismChart data={savingsData} />
        </Card>
      </div>

      <Card title="Index health">
        {indexHealthRows.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {indexHealthRows.map((h, i) => (
              <ProjectHealthCard
                key={h.id}
                name={h.name}
                files={h.files}
                chunks={h.chunks}
                zeroChunkFiles={h.zeroChunkFiles}
                lastIndexed={h.lastIndexed}
                href={`#/project/${h.id}`}
                accent={projectAccents[i % projectAccents.length]}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm py-8 text-center">No projects indexed</p>
        )}
      </Card>

      {langData.length > 0 || typeData.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {langData.length > 0 ? (
            <Card title="Top languages">
              <div className="space-y-2.5">
                {langData.map((l, i) => {
                  const max = langData[0].value || 1
                  return (
                    <div key={l.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-zinc-300 capitalize">{l.name}</span>
                        </div>
                        <span className="tabular-nums text-muted">{fmt(l.value)}</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${(l.value / max) * 100}%`, background: COLORS[i % COLORS.length] }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ) : null}
          {typeData.length > 0 ? (
            <Card title="Chunk types">
              <div className="space-y-2.5">
                {typeData.map((t, i) => {
                  const max = typeData[0].value || 1
                  return (
                    <div key={t.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: COLORS[(i + 3) % COLORS.length] }} />
                          <span className="text-zinc-300 capitalize">{t.name}</span>
                        </div>
                        <span className="tabular-nums text-muted">{fmt(t.value)}</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${(t.value / max) * 100}%`, background: COLORS[(i + 3) % COLORS.length] }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card title="Recent activity">
        {analytics?.recentActivity && analytics.recentActivity.length > 0 ? (
          <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-1.5">
            {analytics.recentActivity.map((e, i) => {
              const meta = TYPE_BADGES[e.type] || { bg: "bg-zinc-700/40 text-zinc-300", Icon: Activity }
              return (
                <div key={i} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded-lg hover:bg-panel2/50">
                  <span className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center ${meta.bg}`}>
                    <meta.Icon size={14} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">{e.type.replace(/_/g, " ")}</span>
                      <span className="text-muted/40">·</span>
                      <span className="text-zinc-400 text-xs">{e.project}</span>
                    </div>
                    <div className="font-mono text-xs text-zinc-300 truncate" title={e.target}>{e.target}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {e.tokensSaved > 0 ? (
                      <div className="text-green-400 text-sm font-semibold tabular-nums">+{fmtK(e.tokensSaved)}</div>
                    ) : null}
                    <div className="text-muted/60 text-[10px]">{relTime(e.ts)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Activity size={36} className="text-muted/40 mx-auto mb-2" />
            <p className="text-muted text-sm">No activity yet</p>
          </div>
        )}
      </Card>
    </div>
  )
}
