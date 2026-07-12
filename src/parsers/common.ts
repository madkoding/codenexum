import type { Chunk } from "../types"

export function lineOf(c: string, idx: number): number {
  let line = 1
  for (let i = 0; i < idx; i++) {
    if (c[i] === "\n") line++
  }
  return line
}

export function createLineResolver(c: string): { lineOf: (idx: number) => number } {
  const newlines: number[] = []
  for (let i = 0; i < c.length; i++) {
    if (c[i] === "\n") newlines.push(i)
  }
  function lineOf(idx: number): number {
    let lo = 0, hi = newlines.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (newlines[mid] < idx) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
  return { lineOf }
}

export function getLang(ext: string): string {
  const map: Record<string, string> = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".go": "go", ".rs": "rust", ".java": "java",
    ".rb": "ruby", ".php": "php",
    ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".cs": "csharp",
    ".css": "css", ".scss": "scss",
    ".html": "html", ".hbs": "html", ".ejs": "html",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".sql": "sql", ".md": "markdown",
  }
  return map[ext] || ext.slice(1) || "unknown"
}

export function makeChunk(partial: Omit<Chunk, "lineEnd" | "body" | "lang"> & { lineEnd?: number; body?: string; lang?: string }, file: string, body?: string): Chunk {
  const lineEnd = partial.lineEnd ?? partial.line
  const contentBody = body ?? partial.content ?? ""
  return {
    ...partial,
    lineEnd,
    body: contentBody,
    lang: partial.lang ?? getLang(fileExt(file)),
  }
}

function fileExt(file: string): string {
  const dot = file.lastIndexOf(".")
  return dot > 0 ? file.slice(dot) : ""
}

export function findBlockEndByBrace(lines: string[], startLine: number): number {
  let depth = 0
  let inString: string | null = null
  let escaped = false
  let started = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    // Skip import/export brace-only lines so they don't skew block depth.
    if (/^(import|export)\s*\{/.test(trimmed)) continue
    inLineComment = false
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      const next = line[j + 1]

      if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; j++ }; continue }
      if (inLineComment) continue

      if (escaped) { escaped = false; continue }
      if (ch === "\\") { escaped = true; continue }

      if (inString) {
        if (ch === inString) { inString = null }
        continue
      }

      if (ch === "/" && next === "/") { inLineComment = true; continue }
      if (ch === "/" && next === "*") { inBlockComment = true; j++; continue }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch
        continue
      }
      if (ch === "{" || ch === "(") {
        if (!started && ch === "{") started = true
        depth++
      } else if (ch === "}" || ch === ")") {
        depth--
        if (started && depth <= 0) return i
      }
    }
  }
  return lines.length - 1
}

export function findBlockEndByIndent(lines: string[], startLine: number): number {
  const baseIndent = getIndent(lines[startLine])
  for (let i = startLine + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    const indent = getIndent(lines[i])
    if (trimmed && indent <= baseIndent) return i - 1
  }
  return lines.length - 1
}

export function findBlockEndByEndKeyword(lines: string[], startLine: number): number {
  let depth = 1
  for (let i = startLine + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith("class ") || trimmed.startsWith("module ") || trimmed.startsWith("def ") || /^(if|unless|while|until|for|begin|case)\b/.test(trimmed)) {
      depth++
    } else if (trimmed === "end") {
      depth--
      if (depth === 0) return i
    }
  }
  return lines.length - 1
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length
}

export function bodyOf(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine, endLine + 1).join("\n")
}

export function countRealBraces(line: string): { open: number; close: number } {
  let open = 0, close = 0
  let inString: string | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let j = 0; j < line.length; j++) {
    const ch = line[j]
    const next = line[j + 1]
    if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; j++ }; continue }
    if (inLineComment) continue
    if (inString) { if (ch === inString) inString = null; continue }
    if (ch === "\\") { j++; continue }
    if (ch === "/" && next === "/") { inLineComment = true; continue }
    if (ch === "/" && next === "*") { inBlockComment = true; j++; continue }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue }
    if (ch === "{") open++
    if (ch === "}") close++
  }
  return { open, close }
}
