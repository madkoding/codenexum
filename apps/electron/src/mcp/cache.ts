export interface CacheEntry {
  output: string
  ts: number
  fileHash?: string
}

const rawCache = new Map<string, CacheEntry>()
const RAW_CACHE_MAX = 200
const RAW_CACHE_TTL = 5 * 60 * 1000

export function rawCacheGet(key: string): CacheEntry | undefined {
  const entry = rawCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > RAW_CACHE_TTL) {
    rawCache.delete(key)
    return undefined
  }
  return entry
}

export function rawCacheSet(key: string, output: string, fileHash?: string): void {
  if (rawCache.size >= RAW_CACHE_MAX) {
    const first = rawCache.keys().next().value
    if (first) rawCache.delete(first)
  }
  rawCache.set(key, { output, ts: Date.now(), fileHash })
}
