import { useEffect, useState, useCallback } from "react"
import { useParams } from "react-router-dom"
import { useWebSocket } from "../hooks/useWebSocket"
import { MetricCard, Card, Row, Gauge, ProgressBar, DataTable, RecommendationCard, Badge } from "../components/ui"
import { fmt, fmtK, pct, relTime, bucketTimeline } from "../lib/format"
import type { ProjectStats, SavingsByMechanism } from "../types"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts"

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b92a8", "#ec4899"]
const GOOD = "#22c55e"
const WARN = "#f59e0b"
const BAD = "#ef4444"

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { subscribe, onChange } = useWebSocket()
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/project/${id}/stats`)
      if (!res.ok) { setError(`Server returned ${res.status}`); return }
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setStats(data)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [id])

  useEffect(() => {
    subscribe("project:stats", id)
    onChange(fetchStats)
    fetchStats()
  }, [subscribe, onChange, fetchStats, id])

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-bad">Error: {error}</p>
        <button onClick={fetchStats} className="px-4 py-2 bg-accent text-white rounded-lg text-sm">Retry</button>
      </div>
    )
  }

  if (!stats) {
    return <p className="text-muted">Loading…</p>
  }

  const hotFiles = stats.hotFiles || []
  const topFiles = stats.topFiles || []
  const recentSearches = stats.recentSearches || []
  const recentEvents = stats.recentEvents || []
  const languages = stats.languages || []
  const savings = stats.savingsByMechanism || ({} as SavingsByMechanism)
  const savingsData = [
    { name: "Index substitution", value: savings.indexSubstitution || 0, key: "indexSubstitution" },
    { name: "Semantic compression", value: savings.semanticCompression || 0, key: "semanticCompression" },
    { name: "Truncation/compression", value: savings.compression || 0, key: "compression" },
    { name: "Search snippets", value: savings.searchSnippets || 0, key: "searchSnippets" },
    { name: "Generative compression", value: savings.generativeCompression || 0, key: "generativeCompression" },
    { name: "Output compression", value: savings.outputCompression || 0, key: "outputCompression" },
  ].filter(d => d.value > 0)

  const efficiencyColor = stats.efficiencyRatio >= 0.8 ? "bg-good" : stats.efficiencyRatio >= 0.5 ? "bg-warn" : "bg-bad"
  const fillColor = stats.contextFill < 0.5 ? "bg-good" : stats.contextFill < 0.8 ? "bg-warn" : "bg-bad"

  const timeline = bucketTimeline(stats.recentEvents.length > 0 ? stats.recentEvents.map((e: any) => ({ ts: e.ts })) : [], 15 * 60 * 1000)

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard value={fmtK(stats.measuredSavings)} label="Tokens saved (real)" subValue={`~${fmt(stats.measuredSavings)}`} />
        <MetricCard value={pct(stats.efficiencyRatio)} label="Efficiency ratio" subValue={`${fmt(stats.indexSubstitutions)} substitutions`} />
        <MetricCard value={pct(stats.contextFill)} label="Context fill" subValue={stats.compactions > 0 ? `${stats.compactions} compactions` : "Healthy"} />
        <MetricCard value={fmtK(stats.avgTokensSavedPerSearch)} label="Avg saved / search" />
        <MetricCard value={fmt(stats.cacheHits)} label="Cache hits" />
        <MetricCard value={fmt(stats.compactions)} label="Compactions" />
      </div>

      {/* Context health + Savings breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Context health" className="lg:col-span-1">
          <div className="flex items-center justify-around py-2">
            <Gauge value={stats.contextFill} label="Context fill" />
            <div className="space-y-4 flex-1 max-w-[200px]">
              <ProgressBar value={stats.efficiencyRatio} label="Efficiency ratio" colorClass={efficiencyColor} />
              <ProgressBar value={1 - stats.missRate} label="Substitution success" colorClass={stats.missRate > 0.25 ? BAD : GOOD} />
            </div>
          </div>
          <div className="mt-4 text-xs text-muted space-y-1">
            <Row label="Native searches" value={fmt(stats.nativeSearches)} />
            <Row label="Native reads" value={fmt(stats.filesRead)} />
            <Row label="Miss rate" value={pct(stats.missRate)} />
          </div>
        </Card>

        <Card title="Tokens saved by mechanism" className="lg:col-span-2">
          <div className="h-56 flex items-center gap-6">
            <div className="h-full w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={savingsData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {savingsData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#12151b", border: "1px solid #1f2937", borderRadius: "8px" }} formatter={(v: any) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {savingsData.map((d, i) => (
                <div key={d.key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-muted">{d.name}</span>
                  </div>
                  <span className="font-medium tabular-nums">{fmtK(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Tool efficiency matrix */}
      <Card title="Tool efficiency matrix">
        {stats.missesByTool.length > 0 ? (
          <DataTable
            rows={stats.missesByTool.map(m => ({
              tool: <span className="font-medium">{m.tool}</span>,
              calls: fmt(m.total),
              misses: <Badge color={m.rate > 0.25 ? "red" : m.rate > 0.1 ? "yellow" : "green"}>{fmt(m.misses)}</Badge>,
              rate: pct(m.rate),
              potential: fmtK(m.potentialTokens),
            }))}
            columns={[
              { key: "tool", label: "Tool" },
              { key: "calls", label: "Native calls", align: "right" },
              { key: "misses", label: "Misses", align: "right" },
              { key: "rate", label: "Miss rate", align: "right" },
              { key: "potential", label: "Avoidable tokens", align: "right" },
            ]}
          />
        ) : <p className="text-muted text-sm">No miss data yet</p>}
      </Card>

      {/* Opportunities + Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top missed reads (opportunities)">
          {stats.topMissedReads.length > 0 ? (
            <DataTable
              rows={stats.topMissedReads.map(r => ({
                file: <span className="truncate max-w-[240px] block" title={r.file}>{r.file}</span>,
                misses: fmt(r.misses),
                potential: fmtK(r.potentialTokens),
              }))}
              columns={[
                { key: "file", label: "File" },
                { key: "misses", label: "Native reads", align: "right" },
                { key: "potential", label: "Avoidable tokens", align: "right" },
              ]}
            />
          ) : <p className="text-muted text-sm">No missed reads yet</p>}
        </Card>

        <Card title="Recommendations">
          {stats.recommendations.length > 0 ? (
            <div className="space-y-3">
              {stats.recommendations.map((r, i) => (
                <RecommendationCard key={i} text={r} severity={r.includes("High") || r.includes("high") ? "warn" : "info"} />
              ))}
            </div>
          ) : <p className="text-muted text-sm">Everything looks efficient</p>}
        </Card>
      </div>

      {/* Timeline */}
      <Card title="Activity & savings (24h)">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#8b92a8", fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: "#8b92a8", fontSize: 11 }} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "#8b92a8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#12151b", border: "1px solid #1f2937", borderRadius: "8px" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="searches" name="Searches" stroke="#3b82f6" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="reads" name="Native reads" stroke="#ef4444" dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="tokensSaved" name="Tokens saved" stroke="#22c55e" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Index + search + details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Index status" className="lg:col-span-1">
          <Row label="Status" value={stats.status || "-"} />
          <Row label="Chunks" value={fmt(stats.chunks)} />
          <Row label="Files" value={fmt(stats.files)} />
          <Row label="Edges" value={fmt(stats.edges)} />
          <Row label="Indexed" value={relTime(stats.indexedAt)} />
          <div className="mt-4">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={languages}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="ext" tick={{ fill: "#8b92a8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8b92a8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#12151b", border: "1px solid #1f2937", borderRadius: "8px" }} />
                  <Bar dataKey="n" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        <Card title="Search index" className="lg:col-span-2">
        </Card>
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Hot files (most dependents)">
          {hotFiles.length > 0 ? hotFiles.map((f, i) => (
            <Row key={i} label={f.file} value={`${fmt(f.n)} deps`} />
          )) : <p className="text-muted text-sm">No dependents yet</p>}
        </Card>

        <Card title="Project map (top files)">
          {topFiles.length > 0 ? topFiles.map((f, i) => (
            <Row key={i} label={f.file} value={`${fmt(f.n)} symbols`} />
          )) : <p className="text-muted text-sm">No data</p>}
        </Card>

        <Card title="Recent searches">
          {recentSearches.length > 0 ? recentSearches.map((s, i) => (
            <div key={i} className="flex justify-between py-1 border-b border-gray-800 last:border-0">
              <span className="text-sm truncate">{s.query}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${s.usedSnippet ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
                {s.usedSnippet ? "snippet" : "read"}
              </span>
            </div>
          )) : <p className="text-muted text-sm">No searches yet</p>}
        </Card>

        <Card title="Recent index activity">
          {recentEvents.length > 0 ? recentEvents.slice(0, 10).map((e, i) => (
            <div key={i} className="flex justify-between py-1 border-b border-gray-800 last:border-0">
              <span className="text-sm truncate">{e.file}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 shrink-0 ml-2">{e.action}</span>
            </div>
          )) : <p className="text-muted text-sm">No recent activity</p>}
        </Card>
      </div>
    </div>
  )
}
