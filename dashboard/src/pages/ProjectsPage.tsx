import { useEffect, useState, useCallback } from "react"
import { useWebSocket } from "../hooks/useWebSocket"
import { MetricCard, Card, Gauge, ProgressBar, DataTable, Badge } from "../components/ui"
import { fmt, fmtK, pct, bucketTimeline } from "../lib/format"
import type { ProjectSummary, AggregateData } from "../types"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts"

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b92a8", "#ec4899"]

export default function ProjectsPage() {
  const { subscribe, onChange } = useWebSocket()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [agg, setAgg] = useState<AggregateData | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [pRes, aRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/aggregate"),
      ])
      if (!pRes.ok || !aRes.ok) return
      setProjects(await pRes.json())
      setAgg(await aRes.json())
    } catch {}
  }, [])

  useEffect(() => {
    subscribe("projects")
    subscribe("aggregate")
    onChange(fetchAll)
    fetchAll()
  }, [subscribe, onChange, fetchAll])

  const totalMeasured = projects.reduce((s, p) => s + (p.measuredSavings || 0), 0)
  const totalSearches = projects.reduce((s, p) => s + p.searches, 0)
  const avgEfficiency = projects.length > 0 ? projects.reduce((s, p) => s + (p.efficiency || 0), 0) / projects.length : 0

  const savingsGlobal = agg?.savingsByMechanismGlobal || {
    indexSubstitution: 0,
    semanticCompression: 0,
    compression: 0,
    searchSnippets: 0,
    generativeCompression: 0,
    outputCompression: 0,
  }
  const savingsData = [
    { name: "Index substitution", value: savingsGlobal.indexSubstitution, key: "indexSubstitution" },
    { name: "Semantic compression", value: savingsGlobal.semanticCompression, key: "semanticCompression" },
    { name: "Truncation/compression", value: savingsGlobal.compression, key: "compression" },
    { name: "Search snippets", value: savingsGlobal.searchSnippets, key: "searchSnippets" },
    { name: "Generative compression", value: savingsGlobal.generativeCompression, key: "generativeCompression" },
    { name: "Output compression", value: savingsGlobal.outputCompression, key: "outputCompression" },
  ].filter(d => d.value > 0)

  const timeline = bucketTimeline(agg?.timeline || [], 15 * 60 * 1000)

  return (
    <div className="space-y-4">
      {/* Hero metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard value={fmtK(totalMeasured)} label="Tokens saved (real)" subValue={`~${fmt(totalMeasured)}`} />
        <MetricCard value={fmt(totalSearches)} label="Total searches" />
        <MetricCard value={fmt(projects.length)} label="Projects indexed" />
      </div>

      {/* Main charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="Global savings by mechanism" className="lg:col-span-2">
          <div className="h-56 flex items-center gap-6">
            <div className="h-full w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={savingsData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {savingsData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
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

        <Card title="Context pressure">
          <div className="flex flex-col items-center justify-center h-full">
            <Gauge value={agg?.globalEfficiency ?? avgEfficiency} label="Global efficiency" />
            <div className="w-full mt-6 space-y-3">
              <ProgressBar value={agg?.globalEfficiency ?? avgEfficiency} label="Efficiency ratio" colorClass={avgEfficiency >= 0.8 ? "bg-good" : avgEfficiency >= 0.5 ? "bg-warn" : "bg-bad"} />
              <div className="flex justify-between text-xs text-muted">
                <span>Native reads: {fmt(agg?.totalReads ?? 0)}</span>
                <span>Cache hits: {fmt(agg?.totalCacheHits ?? 0)}</span>
              </div>
            </div>
          </div>
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
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="searches" name="Searches" stroke="#3b82f6" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="reads" name="Native reads" stroke="#ef4444" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="indexSubstitutions" name="Index substitutions" stroke="#22c55e" dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="tokensSaved" name="Tokens saved" stroke="#a855f7" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Per-project table */}
      <Card title="Projects">
        <DataTable
          rows={projects.map(p => ({
            name: p.name,
            searches: fmt(p.searches),
            efficiency: <Badge color={p.efficiency >= 0.8 ? "green" : p.efficiency >= 0.5 ? "yellow" : "red"}>{pct(p.efficiency)}</Badge>,
            saved: fmtK(p.measuredSavings),
            reads: fmt(p.filesRead),
          }))}
          columns={[
            { key: "name", label: "Project" },
            { key: "searches", label: "Searches", align: "right" },
            { key: "efficiency", label: "Efficiency", align: "right" },
            { key: "saved", label: "Tokens saved", align: "right" },
            { key: "reads", label: "Native reads", align: "right" },
          ]}
        />
      </Card>
    </div>
  )
}
