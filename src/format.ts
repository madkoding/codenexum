import type { SearchResult } from "./store"

export interface FormatOptions {
  compact?: boolean
  snippetLines?: number
}

const DEFAULT_SNIPPET_LINES = 20

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

  return display
    .map((line, idx) => {
      const num = startLine + idx
      // Re-number placeholder lines so they don't look like real line numbers
      if (line.startsWith("…") && line.endsWith("…")) {
        return `   │ ${line}`
      }
      return `${String(num).padStart(3)}│ ${line}`
    })
    .join("\n")
}

export function formatSearchResults(
  results: SearchResult[],
  projectRoot: string,
  options: FormatOptions = {},
): string {
  return results.map(r => formatSearchResult(r, projectRoot, options)).join("\n\n")
}
