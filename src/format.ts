import type { SearchResult } from "./store"

export interface FormatOptions {
  compact?: boolean
  snippetLines?: number
  groupByFile?: boolean
}

export function getDefaultSnippetLines(): number {
  const v = process.env.CONTEXT_MANAGER_SNIPPET_LINES
  if (!v) return 12
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 12
}

const DEFAULT_SNIPPET_LINES = getDefaultSnippetLines()

export function formatSearchResult(
  result: SearchResult,
  projectRoot: string,
  options: FormatOptions = {},
): string {
  const { compact = false, snippetLines = DEFAULT_SNIPPET_LINES } = options
  const rel = relativePath(projectRoot, result.file)
  const range = result.lineEnd > result.line ? `${rel}:${result.line}-${result.lineEnd}` : `${rel}:${result.line}`
  const header = `${result.type} ${result.name} @ ${range}`

  if (compact) return header

  const snippet = buildSnippet(result.body, snippetLines, result.line)
  if (!snippet) return header

  return `${header}\n${snippet}`
}

function relativePath(root: string, file: string): string {
  if (!root) return file
  if (file.startsWith(root)) {
    let rel = file.slice(root.length)
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1)
    return rel || file
  }
  return file
}

function buildSnippet(body: string, maxLines: number, startLine: number): string {
  if (!body) return ""
  const lines = body.split("\n")
  if (lines.length === 0) return ""

  let display: string[]
  if (lines.length <= maxLines) {
    display = lines
  } else {
    const head = Math.ceil(maxLines * 0.7)
    const tail = maxLines - head
    display = [...lines.slice(0, head), `… (${lines.length - head - tail} more lines) …`, ...lines.slice(-tail)]
  }

  let realLine = startLine
  return display
    .map((line) => {
      // Placeholder elision lines are not real code lines; don't consume a line number.
      if (line.startsWith("…") && line.endsWith("…")) {
        return `   │ ${line}`
      }
      const num = realLine++
      return `${String(num).padStart(3)}│ ${line}`
    })
    .join("\n")
}

export function formatSearchResults(
  results: SearchResult[],
  projectRoot: string,
  options: FormatOptions = {},
): string {
  if (options.groupByFile ?? shouldGroupResults(results.length)) {
    return formatSearchResultsGrouped(results, projectRoot, options)
  }
  return results.map(r => formatSearchResult(r, projectRoot, options)).join("\n\n")
}

export function shouldGroupResults(resultCount: number): boolean {
  return resultCount >= 5
}

function formatSearchResultsGrouped(
  results: SearchResult[],
  projectRoot: string,
  options: FormatOptions = {},
): string {
  const grouped = new Map<string, SearchResult[]>()
  for (const r of results) {
    const list = grouped.get(r.file) || []
    list.push(r)
    grouped.set(r.file, list)
  }

  const snippetLines = options.snippetLines ?? getDefaultSnippetLines()
  const lines: string[] = []
  for (const [file, fileResults] of grouped) {
    const rel = relativePath(projectRoot, file)
    lines.push(rel)
    for (const r of fileResults) {
      const range = r.lineEnd > r.line ? `${r.line}-${r.lineEnd}` : `${r.line}`
      lines.push(`  ${r.type} ${r.name} @ ${range}`)
      if (!options.compact) {
        const snippet = buildSnippet(r.body, snippetLines, r.line)
        if (snippet) {
          for (const line of snippet.split("\n")) {
            lines.push(`    ${line}`)
          }
        }
      }
    }
  }
  return lines.join("\n")
}
