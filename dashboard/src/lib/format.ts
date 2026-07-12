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

export function bucketTimeline<T extends { ts: number }>(
  timeline: T[],
  intervalMs = 15 * 60 * 1000,
): T[] {
  if (timeline.length === 0) return []
  const buckets = new Map<number, any>()
  for (const point of timeline) {
    const bucketTs = Math.floor(point.ts / intervalMs) * intervalMs
    if (!buckets.has(bucketTs)) {
      const clone: any = { ...point, ts: bucketTs }
      for (const key of Object.keys(point)) {
        if (key !== "ts" && typeof (point as any)[key] === "number") clone[key] = 0
      }
      buckets.set(bucketTs, clone)
    }
    const bucket = buckets.get(bucketTs)
    for (const key of Object.keys(point)) {
      if (key !== "ts" && typeof (point as any)[key] === "number") {
        bucket[key] += (point as any)[key]
      }
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts) as T[]
}
