import type { Chunk } from "../types"

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
  for (let i = startLine; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // Skip import/export brace-only lines so they don't skew block depth.
    if (/^(import|export)\s*\{/.test(trimmed)) continue
    for (const ch of lines[i]) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (inString) {
        if (ch === inString) inString = null
        continue
      }
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
