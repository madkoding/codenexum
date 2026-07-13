export function fmt(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString()
}

export function fmtK(n: number | undefined | null): string {
  const v = n ?? 0
  if (v >= 1000000) return (v / 1000000).toFixed(1) + "M"
  if (v >= 1000) return (v / 1000).toFixed(1) + "K"
  return String(v)
}

export function pct(n: number | undefined | null): string {
  const v = Math.min(100, Math.max(0, ((n ?? 0) * 100)))
  return v.toFixed(0) + "%"
}

export function relTime(ts: string | null | undefined): string {
  if (!ts) return "-"
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 0) return "just now"
  if (s < 60) return s + "s ago"
  if (s < 3600) return Math.floor(s / 60) + "m ago"
  if (s < 86400) return Math.floor(s / 3600) + "h ago"
  return Math.floor(s / 86400) + "d ago"
}
