import type { ReactNode } from "react"

export function MetricCard({ value, label, className = "", subValue }: { value: string; label: string; className?: string; subValue?: string }) {
  return (
    <div className={`bg-panel border border-gray-800 rounded-xl p-5 ${className}`}>
      <div className="text-2xl md:text-3xl font-bold text-accent">{value}</div>
      {subValue ? <div className="text-xs text-muted mt-1">{subValue}</div> : null}
      <div className="text-muted text-sm mt-1">{label}</div>
    </div>
  )
}

export function Card({ title, children, className = "", action }: { title: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={`bg-panel border border-gray-800 rounded-xl p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-muted">{title}</h2>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function Row({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between py-1 border-b border-gray-800 last:border-0">
      <span className="text-sm">{label}</span>
      <span className={`text-sm font-medium ${highlight ? "text-accent" : muted ? "text-muted" : ""}`}>{value}</span>
    </div>
  )
}

export function Gauge({ value, label, size = 120 }: { value: number; label: string; size?: number }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  const radius = (size - 16) / 2
  const circumference = radius * Math.PI
  const offset = circumference * (1 - pct / 100)
  let color = "#22c55e"
  if (pct > 50) color = "#f59e0b"
  if (pct > 80) color = "#ef4444"
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 8} className="overflow-visible">
        <path d={`M 8 ${size / 2 + 4} A ${radius} ${radius} 0 0 1 ${size - 8} ${size / 2 + 4}`} fill="none" stroke="#1f2937" strokeWidth={10} strokeLinecap="round" />
        <path d={`M 8 ${size / 2 + 4} A ${radius} ${radius} 0 0 1 ${size - 8} ${size / 2 + 4}`} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="text-2xl font-bold" style={{ color }}>{pct.toFixed(0)}%</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  )
}

export function ProgressBar({ value, label, colorClass = "bg-accent" }: { value: number; label?: string; colorClass?: string }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  return (
    <div>
      {label ? <div className="flex justify-between text-xs text-muted mb-1"><span>{label}</span><span>{pct.toFixed(0)}%</span></div> : null}
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function RecommendationCard({ text, severity = "info" }: { text: string; severity?: "info" | "warn" | "good" }) {
  const colors = {
    info: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    good: "border-green-500/30 bg-green-500/10 text-green-200",
  }
  return (
    <div className={`rounded-lg px-4 py-3 text-sm border ${colors[severity]}`}>
      {text}
    </div>
  )
}

export function DataTable({ rows, columns }: { rows: Record<string, ReactNode>[]; columns: { key: string; label: string; align?: "left" | "right" }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-gray-800">
            {columns.map(c => (
              <th key={c.key} className={`pb-2 ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-800/50 last:border-0">
              {columns.map(c => (
                <td key={c.key} className={`py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: "green" | "yellow" | "red" | "gray" | "blue" }) {
  const map: Record<string, string> = {
    green: "bg-green-500/15 text-green-400",
    yellow: "bg-amber-500/15 text-amber-400",
    red: "bg-red-500/15 text-red-400",
    gray: "bg-gray-800 text-muted",
    blue: "bg-blue-500/15 text-blue-400",
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${map[color]}`}>{children}</span>
  )
}
