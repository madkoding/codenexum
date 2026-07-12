// Cache for recent native tool outputs that can be answered from the local
// code index.  The native tool still executes (the plugin API does not allow
// cancelling execution), but we avoid re-formatting the same compact output
// and we can return the cached compact version immediately in .after.

export interface CacheEntry {
  /** Output that should be returned to the model (usually the index substitute). */
  output: string
  /** When this entry was created. */
  ts: number
  /** Hash of the indexed file(s) at the time of caching. */
  fileHash?: string
}

const DEFAULT_MAX_ENTRIES = 50
const MAX_ENTRIES_HARD_CAP = 5000
const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

function getMaxEntries(): number {
  const v = process.env.CONTEXT_MANAGER_CACHE_MAX_ENTRIES
  if (!v) return DEFAULT_MAX_ENTRIES
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ENTRIES
}

function getTtlMs(): number {
  const v = process.env.CONTEXT_MANAGER_CACHE_TTL_MS
  if (!v) return DEFAULT_TTL_MS
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS
}

export class ToolOutputCache {
  private cache = new Map<string, CacheEntry>()
  private max: number
  private ttl: number

  constructor(max = getMaxEntries(), ttl = getTtlMs()) {
    this.max = Math.min(Math.max(1, max), MAX_ENTRIES_HARD_CAP)
    this.ttl = ttl
  }

  private now(): number {
    return Date.now()
  }

  private key(tool: string, input: Record<string, unknown>): string {
    const normalized = JSON.stringify(input, Object.keys(input).sort())
    return `${tool}::${normalized}`
  }

  get(tool: string, input: Record<string, unknown>, currentFileHash?: string): CacheEntry | undefined {
    const k = this.key(tool, input)
    const entry = this.cache.get(k)
    if (!entry) return undefined
    if (this.now() - entry.ts > this.ttl) {
      this.cache.delete(k)
      return undefined
    }
    if (currentFileHash && entry.fileHash && entry.fileHash !== currentFileHash) {
      this.cache.delete(k)
      return undefined
    }
    return entry
  }

  set(tool: string, input: Record<string, unknown>, output: string, fileHash?: string): void {
    if (process.env.CONTEXT_MANAGER_CACHE_TOOLS === "0") return
    const k = this.key(tool, input)
    this.cache.set(k, { output, ts: this.now(), fileHash })
    this.evictIfNeeded()
  }

  clear(): void {
    this.cache.clear()
  }

  private evictIfNeeded(): void {
    // Map iteration follows insertion order; delete the oldest entries first.
    while (this.cache.size > this.max) {
      const first = this.cache.keys().next().value as string | undefined
      if (first) this.cache.delete(first)
      else break
    }
  }
}
