import { useEffect, useState, useCallback, type ComponentType } from "react"
import { Link } from "react-router-dom"
import { Card, EmptyState, LoadingScreen, Spinner, PeriodSwitcher, PERIOD_LABELS, type Period } from "../components/ui"
import { fmt, fmtK, pct, relTime } from "../lib/format"
import type { Project, ProjectSummary } from "../types"
import {
  BarChart3, Zap, Target, FolderGit2,
  Search, Sparkles, FileText, Database, Minimize2, Brain,
  TrendingUp, Clock, Activity, PiggyBank,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip, Legend,
} from "recharts"

interface AggregateData {
  byType: Record<string, number>
  byLang: Record<string, number>
  topFiles: { path: string; count: number }[]
}

type Mechanism = "indexSubstitution" | "searchSnippets" | "compression" | "semanticCompression" | "cacheHit"

interface AnalyticsData {
  period?: Period
  granularity?: "hour" | "day" | "month" | "year"
  activityTimeline: { hour: string; count: number; saved: number; byMechanism: Record<Mechanism, number> }[]
  cumulativeSavings: { ts: string; total: number }[]
  topQueries: { query: string; count: number; saved: number }[]
  recentActivity: { type: string; target: string; tokensSaved: number; ts: string; project: string }[]
  indexHealth: { id: string; name: string; path: string; lastIndexed: string | null; chunks: number; files: number; zeroChunkFiles: number }[]
  hotFiles: { path: string; count: number; project: string; chunks: number }[]
}

const MECHANISM_COLORS: Record<Mechanism, string> = {
  indexSubstitution: "#3b82f6",
  searchSnippets: "#22c55e",
  compression: "#f59e0b",
  semanticCompression: "#ec4899",
  cacheHit: "#06b6d4",
}

const MECHANISM_LABELS: Record<Mechanism, string> = {
  indexSubstitution: "Index subst.",
  searchSnippets: "Search snippets",
  compression: "Compression",
  semanticCompression: "Semantic",
  cacheHit: "Cache hit",
}

const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function formatBucketLabel(key: string, granularity: "hour" | "day" | "month" | "year" | undefined): string {
  if (!key) return ""
  if (granularity === "year" || granularity === "month") {
    const m = parseInt(key.slice(5, 7), 10)
    return m >= 1 && m <= 12 ? MONTH_SHORT[m - 1] : key
  }
  if (granularity === "day") {
    const d = new Date(key + "T00:00:00Z")
    if (!Number.isNaN(d.getTime())) {
      return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`
    }
    return key
  }
  if (granularity === "hour" || key.length >= 13) {
    const t = key.length >= 16 ? key.slice(11, 16) : key.slice(11, 13) + ":00"
    return t
  }
  return key
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
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - ratio)
  const labelOffset = Math.round(size * 0.16)
  return (
    <div className="flex flex-col items-center min-w-0 w-full">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 block">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={4} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums"
          style={{ color }}
        >
          {ratio > 0 ? `${(ratio * 100).toFixed(0)}%` : "—"}
        </div>
      </div>
      <div className="text-[10px] text-muted mt-1.5 text-center leading-tight truncate w-full" style={{ paddingTop: labelOffset > 0 ? 0 : undefined }}>{label}</div>
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

function ProjectHealthCard({ name, files, chunks, zeroChunkFiles, lastIndexed, href, accent, onForget }: { name: string; files: number; chunks: number; zeroChunkFiles: number; lastIndexed: string | null; href: string; accent: string; onForget?: () => void }) {
  const lastTs = lastIndexed ? new Date(lastIndexed).getTime() : 0
  const ageHours = lastTs ? (Date.now() - lastTs) / (1000 * 60 * 60) : Infinity
  const freshness = ageHours < 1 ? 1 : ageHours < 24 ? 0.8 : ageHours < 168 ? 0.5 : 0.2
  const indexedFiles = Math.max(0, files - zeroChunkFiles)
  return (
    <div className="group relative flex flex-col bg-panel border border-gray-800 rounded-xl p-3.5 hover:border-accent/50 transition-colors min-w-0 overflow-hidden h-full">
      <Link
        to={href}
        className="flex flex-col flex-1 min-w-0"
      >
        <div className="flex items-start gap-2 mb-3 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: accent }} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate text-sm" title={name}>{name}</div>
            <div className="text-[11px] text-muted mt-0.5 truncate">
              {lastIndexed ? `Updated ${relTime(lastIndexed)}` : "Never indexed"}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 mb-3 min-w-0">
          <MiniRing value={indexedFiles} max={files || 1} label="Indexed" color={accent} />
          <MiniRing value={freshness} max={1} label="Fresh" color="#22c55e" />
        </div>
        <div className="mt-auto pt-2 border-t border-gray-800/60 grid grid-cols-2 gap-2 min-w-0">
          <div className="text-center min-w-0">
            <div className="text-sm font-bold tabular-nums truncate" title={fmtK(chunks)}>{fmtK(chunks)}</div>
            <div className="text-[10px] text-muted truncate">chunks</div>
          </div>
          <div className="text-center min-w-0">
            <div className="text-sm font-bold tabular-nums truncate" title={fmt(files)}>{fmt(files)}</div>
            <div className="text-[10px] text-muted truncate">files</div>
          </div>
        </div>
      </Link>
      {onForget ? (
        <button
          onClick={(e) => { e.preventDefault(); if (confirm(`Forget project "${name}"? This removes its index and DB.`)) onForget() }}
          className="absolute top-2 right-2 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Forget this project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      ) : null}
    </div>
  )
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [agg, setAgg] = useState<AggregateData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [period, setPeriod] = useState<Period>("week")
  const [periodLoading, setPeriodLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async (signal: AbortSignal) => {
    const url = await window.electronAPI.invoke("get-mcp-url")
    if (!url) { setError("MCP server URL not available"); return }
    const anRes = await fetch(`${url}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "cm_analytics", args: { period } }),
      signal,
    })
    if (anRes.ok) {
      const anData = await anRes.json()
      setAnalytics(anData.result || null)
    }
  }, [period])

  const fetchAll = useCallback(async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 10_000)
    try {
      const url = await window.electronAPI.invoke("get-mcp-url")
      if (!url) { setError("MCP server URL not available"); setLoading(false); return }
      const pRes = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_projects_list", args: {} }),
        signal: abort.signal,
      })
      if (!pRes.ok) { setError(`Server returned ${pRes.status}`); setLoading(false); return }
      const pData = await pRes.json()
      if (pData.error) { setError(typeof pData.error === "string" ? pData.error : pData.error.message || JSON.stringify(pData.error)); setLoading(false); return }
      const list = (pData.result || pData.projects || []) as Project[]
      setProjects(list.map(p => ({ ...p, chunks: p.chunks || 0, files: p.files || 0, edges: 0, measuredSavings: 0, searches: 0, efficiencyRatio: 0 })))
      const aRes = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_aggregate", args: {} }),
        signal: abort.signal,
      })
      const top5 = list.slice(0, 5)
      const enrichedTop = await Promise.all(top5.map(async (p) => {
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
      const enrichedMap = new Map<ProjectSummary["id"], ProjectSummary>(enrichedTop.map(p => [p.id, p as ProjectSummary]))
      setProjects(prev => prev.map(p => enrichedMap.get(p.id) || (p as ProjectSummary)))
      if (aRes.ok) {
        const aData = await aRes.json()
        setAgg(aData.result || aData.aggregate || null)
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

  useEffect(() => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 10_000)
    setPeriodLoading(true)
    fetchAnalytics(abort.signal)
      .catch(() => {})
      .finally(() => setPeriodLoading(false))
    return () => { clearTimeout(timer); abort.abort() }
  }, [period])

  const forgetProject = useCallback(async (id: string) => {
    try {
      const url = await window.electronAPI.invoke("get-mcp-url")
      await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_projects_delete", args: { id } }),
      })
      fetchAll()
    } catch {}
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

  const activeProjects = projects.filter(p => (p.measuredSavings || 0) > 0 || (p.efficiencyRatio || 0) > 0)
  const totalChunks = projects.reduce((s, p) => s + (p.chunks || 0), 0)
  const totalSavings = activeProjects.reduce((s, p) => s + (p.measuredSavings || 0), 0)
  const avgEfficiency = activeProjects.length > 0
    ? activeProjects.reduce((s, p) => s + (p.efficiencyRatio || 0), 0) / activeProjects.length
    : 0
  const hasUsageData = totalSavings > 0 || avgEfficiency > 0

  const activityInPeriod = analytics?.activityTimeline.reduce((s, b) => s + b.count, 0) || 0
  const savedInPeriod = analytics?.activityTimeline.reduce((s, b) => s + b.saved, 0) || 0
  const granularity = analytics?.granularity

  const savingsByBucket = (analytics?.activityTimeline || []).map((b) => {
    const bucket: Record<string, any> = { bucket: formatBucketLabel(b.hour, granularity) }
    for (const m of Object.keys(b.byMechanism || {}) as Mechanism[]) {
      bucket[m] = b.byMechanism[m] || 0
    }
    return bucket
  })

  const activityChartData = (analytics?.activityTimeline || []).map(b => ({
    hour: formatBucketLabel(b.hour, granularity),
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
        {hasUsageData ? (
          <>
            <HeroMetric
              value={fmtK(totalSavings)}
              label="Tokens saved"
              accent="from-blue-600/40 to-blue-900/40"
              Icon={Zap}
            />
            <HeroMetric
              value={fmt(activityInPeriod)}
              label={`Eventos (${PERIOD_LABELS[period]})`}
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
          </>
        ) : (
          <>
            <HeroMetric
              value={fmt(activityInPeriod)}
              label={`Eventos (${PERIOD_LABELS[period]})`}
              accent="from-green-600/40 to-green-900/40"
              Icon={BarChart3}
            />
            <HeroMetric
              value={fmt(projects.length)}
              label="Active projects"
              accent="from-amber-600/40 to-amber-900/40"
              Icon={FolderGit2}
            />
            <div className="col-span-2 relative overflow-hidden rounded-xl border border-dashed border-gray-700 bg-gradient-to-br from-zinc-800/40 to-zinc-900/40 p-4 flex flex-col items-center justify-center">
              <BarChart3 size={28} className="text-muted/40 mb-1.5" />
              <p className="text-sm font-medium text-zinc-400">Awaiting usage data</p>
              <p className="text-xs text-muted/60 mt-1 text-center">Savings and intercept metrics will appear once projects are used with opencode</p>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          title={`Ahorros por mecanismo (${PERIOD_LABELS[period]})`}
          action={<PeriodSwitcher value={period} onChange={setPeriod} />}
        >
          <div className="relative h-56">
            {savedInPeriod > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={savingsByBucket} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="bucket" tick={{ fill: "#8b92a8", fontSize: 10 }} interval={Math.max(0, Math.floor(savingsByBucket.length / 8) - 1)} />
                  <YAxis tick={{ fill: "#8b92a8", fontSize: 10 }} tickFormatter={(v) => fmtK(v as number)} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }}
                    formatter={(v: any, name: any) => [fmtK(v as number), MECHANISM_LABELS[name as Mechanism] || name]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 10, color: "#8b92a8" }}
                    formatter={(v) => MECHANISM_LABELS[v as Mechanism] || v}
                    iconType="circle"
                    iconSize={8}
                  />
                  {(Object.keys(MECHANISM_COLORS) as Mechanism[]).map((m) => (
                    <Bar key={m} dataKey={m} stackId="savings" fill={MECHANISM_COLORS[m]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <TrendingUp size={36} className="text-muted/40 mb-2" />
                <p className="text-muted text-sm">No savings recorded yet</p>
                <p className="text-muted/60 text-xs mt-1">Use <code className="text-accent">context_search</code> or any tool — savings accumulate automatically</p>
              </div>
            )}
            {periodLoading ? (
              <div className="absolute inset-0 bg-panel/60 backdrop-blur-[1px] flex items-center justify-center rounded-lg transition-opacity">
                <Spinner size={18} />
              </div>
            ) : null}
          </div>
        </Card>

        <Card
          title={`Actividad por ${granularity === "hour" ? "hora" : granularity === "day" ? "día" : granularity === "month" ? "día" : "mes"} (${PERIOD_LABELS[period]})`}
          action={<PeriodSwitcher value={period} onChange={setPeriod} />}
        >
          <div className="relative h-56">
            {activityChartData.some(d => d.Events > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="hour" tick={{ fill: "#8b92a8", fontSize: 10 }} interval={Math.max(0, Math.floor(activityChartData.length / 8) - 1)} />
                  <YAxis tick={{ fill: "#8b92a8", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }} />
                  <Bar dataKey="Events" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <Clock size={36} className="text-muted/40 mb-2" />
                <p className="text-muted text-sm">No activity in {PERIOD_LABELS[period].toLowerCase()}</p>
              </div>
            )}
            {periodLoading ? (
              <div className="absolute inset-0 bg-panel/60 backdrop-blur-[1px] flex items-center justify-center rounded-lg transition-opacity">
                <Spinner size={18} />
              </div>
            ) : null}
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 items-stretch">
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
                onForget={() => forgetProject(h.id)}
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
