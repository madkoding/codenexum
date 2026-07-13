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
