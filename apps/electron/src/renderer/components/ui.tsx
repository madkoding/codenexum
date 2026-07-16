import type { ReactNode } from "react"

export function Card({ title, children, className = "", action }: { title: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={`bg-panel border border-gray-800 rounded-xl p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wider text-muted">{title}</h2>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description: string }) {
  return (
    <div className="text-center py-12 px-6">
      {icon ? <div className="mb-4 flex justify-center">{icon}</div> : null}
      <h3 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h3>
      <p className="text-sm text-muted max-w-md mx-auto">{description}</p>
    </div>
  )
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-zinc-700 border-t-accent ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function LoadingScreen({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted">
      <Spinner size={24} />
      <p className="text-sm">{message}</p>
    </div>
  )
}

export type Period = "year" | "month" | "week" | "day"

export const PERIOD_LABELS: Record<Period, string> = {
  year: "Año",
  month: "Mes",
  week: "Semana",
  day: "Día",
}

export function PeriodSwitcher({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const order: Period[] = ["year", "month", "week", "day"]
  return (
    <div className="inline-flex items-center rounded-md border border-gray-800 bg-bg/60 p-0.5 text-[11px]">
      {order.map((p) => {
        const active = p === value
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={
              "px-2.5 py-1 rounded transition-colors " +
              (active
                ? "bg-accent/20 text-accent font-semibold"
                : "text-muted hover:text-zinc-200")
            }
          >
            {PERIOD_LABELS[p]}
          </button>
        )
      })}
    </div>
  )
}
