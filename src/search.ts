import type { Database } from "bun:sqlite"
import { dbRawSearch, type SearchResult } from "./store"
import { statSync } from "fs"

export interface ParsedQuery {
  raw: string
  terms: string[]
  filters: {
    type?: string
    file?: string
    lang?: string
  }
}

const VALID_TYPES = new Set([
  "function", "class", "interface", "type", "enum",
  "import", "export", "decorator", "selector", "component", "config", "table", "heading",
])

export function parseQuery(query: string): ParsedQuery {
  const terms: string[] = []
  const filters: ParsedQuery["filters"] = {}

  // Split on spaces but keep quoted phrases intact.
  const parts = query.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const filterMatch = trimmed.match(/^(type|file|lang):(.+)$/i)
    if (filterMatch) {
      const key = filterMatch[1].toLowerCase() as keyof ParsedQuery["filters"]
      let value = filterMatch[2]
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      filters[key] = value.toLowerCase()
      continue
    }

    // Strip surrounding quotes from search terms
    let term = trimmed
    if ((term.startsWith('"') && term.endsWith('"')) || (term.startsWith("'") && term.endsWith("'"))) {
      term = term.slice(1, -1)
    }
    if (term.length >= 2) terms.push(term.toLowerCase())
  }

  return { raw: query, terms, filters }
}

export function buildSearchQuery(parsed: ParsedQuery): string {
  // If type filter is present, include it in the FTS query so the index can narrow results.
  const parts: string[] = [...parsed.terms]
  if (parsed.filters.type && VALID_TYPES.has(parsed.filters.type)) {
    parts.push(parsed.filters.type)
  }
  return parts.length > 0 ? parts.map(t => `"${t}"`).join(" OR ") : ""
}

export function search(db: Database, query: string, n: number): SearchResult[] {
  const parsed = parseQuery(query)
  const ftsQuery = buildSearchQuery(parsed)
  if (!ftsQuery) return []

  let results = dbRawSearch(db, ftsQuery, n * 3)
  if (!results.length) return []

  results = applyFilters(results, parsed.filters)
  results = rankResults(results, parsed)
  return results.slice(0, n)
}

function applyFilters(results: SearchResult[], filters: ParsedQuery["filters"]): SearchResult[] {
  return results.filter(r => {
    if (filters.type && r.type.toLowerCase() !== filters.type) return false
    if (filters.file && !r.file.toLowerCase().includes(filters.file)) return false
    if (filters.lang && r.lang.toLowerCase() !== filters.lang) return false
    return true
  })
}

function rankResults(results: SearchResult[], parsed: ParsedQuery): SearchResult[] {
  const terms = parsed.terms
  const typeFilter = parsed.filters.type

  const scored = results.map(r => {
    let score = r.score // BM25 base (lower is better in FTS5, but we re-rank)

    const nameLower = r.name.toLowerCase()
    const contentLower = r.content.toLowerCase()

    // Exact name match is the strongest signal
    if (terms.some(t => nameLower === t)) {
      score -= 1000
    } else if (terms.some(t => nameLower.includes(t))) {
      score -= 500
    }

    // Prefix match in name
    if (terms.some(t => nameLower.startsWith(t))) {
      score -= 300
    }

    // Content match
    if (terms.some(t => contentLower.includes(t))) {
      score -= 100
    }

    // Prefer definitions matching the requested type
    if (typeFilter && r.type.toLowerCase() === typeFilter) {
      score -= 200
    }

    // Penalize test/spec/fixture files
    const pathLower = r.file.toLowerCase()
    const isTestLike = /(test|spec|fixture|mock|__tests__|\.test\.|\.spec\.)/.test(pathLower)
    if (isTestLike) {
      score += 300
    }

    // Boost recently modified files
    try {
      const mtime = statSync(r.file).mtimeMs
      const daysOld = (Date.now() - mtime) / (1000 * 60 * 60 * 24)
      if (daysOld < 7) score -= 50
      else if (daysOld < 30) score -= 25
    } catch {}

    return { ...r, score }
  })

  // Sort by score ascending (lower is better)
  scored.sort((a, b) => a.score - b.score)
  return scored
}
