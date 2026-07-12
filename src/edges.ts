import type { Chunk } from "./types"

export type EdgeKind = "import" | "call" | "extend" | "implement" | "reference"

export interface Edge {
  sourceFile: string
  sourceSymbol: string
  targetFile: string
  targetSymbol: string
  kind: EdgeKind
}

const JS_KEYWORDS = new Set([
  "if", "while", "for", "switch", "catch", "return", "throw", "typeof", "new",
  "function", "class", "const", "let", "var", "async", "await", "import", "export",
])

const LOCAL_IMPORT_RE = /(?:^|\n)\s*import\s+(?:(?:\*\s+as\s+)?\w+\s+from\s+|[\w\s{},*]+from\s+)['"](\.[^'"]+)['"]/g

const REQUIRE_RE = /(?:^|\n)\s*(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g

const CALL_RE = /[^\w.](\w+)\s*\(/g

const EXTENDS_RE = /(?:^|\n)\s*class\s+\w+\s+extends\s+(\w+)/g

const IMPLEMENTS_RE = /(?:^|\n)\s*class\s+\w+(?:\s+extends\s+\w+)?\s+implements\s+([\w,\s]+)/g

export function resolveRelativePath(baseFile: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) return null
  const { dirname, extname, join, normalize } = require("path")
  const dir = dirname(baseFile)
  let resolved = join(dir, importPath)
  const ext = extname(resolved)
  if (!ext) {
    const candidates = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]
    let found = false
    for (const cand of candidates) {
      try {
        const { existsSync } = require("fs")
        if (existsSync(resolved + cand)) {
          resolved = resolved + cand
          found = true
          break
        }
      } catch {}
    }
    if (!found) {
      // No file on disk; return best-guess extension for indexing purposes.
      resolved = resolved + ".ts"
    }
  }
  return normalize(resolved)
}

export function extractEdges(chunks: Chunk[]): Edge[] {
  const edges: Edge[] = []
  const byFile = groupByFile(chunks)
  const byName = new Map<string, Chunk[]>()
  for (const c of chunks) {
    if (isSymbolType(c.type)) {
      let a = byName.get(c.name)
      if (!a) { a = []; byName.set(c.name, a) }
      a.push(c)
    }
  }

  for (const c of chunks) {
    if (c.type === "import") {
      const local = findLocalImport(c.content)
      if (local) {
        const targetFile = resolveRelativePath(c.file, local.path)
        if (targetFile) {
          edges.push({
            sourceFile: c.file,
            sourceSymbol: local.name || c.name,
            targetFile,
            targetSymbol: "*",
            kind: "import",
          })
        }
      }
      continue
    }

    if (c.type !== "function" && c.type !== "class") continue

    const body = c.body || ""

    let m: RegExpExecArray | null
    CALL_RE.lastIndex = 0
    while ((m = CALL_RE.exec(body)) !== null) {
      const callee = m[1]
      if (JS_KEYWORDS.has(callee)) continue
      if (callee === c.name && c.type === "function") continue // self-call in declaration
      const target = findSymbol(byFile, byName, c.file, callee)
      if (target && (target.file !== c.file || target.name !== c.name)) {
        edges.push({
          sourceFile: c.file,
          sourceSymbol: c.name,
          targetFile: target.file,
          targetSymbol: target.name,
          kind: "call",
        })
      }
    }

    EXTENDS_RE.lastIndex = 0
    while ((m = EXTENDS_RE.exec(body)) !== null) {
      const parent = m[1]
      const target = findSymbol(byFile, byName, c.file, parent)
      if (target) {
        edges.push({
          sourceFile: c.file,
          sourceSymbol: c.name,
          targetFile: target.file,
          targetSymbol: target.name,
          kind: "extend",
        })
      }
    }

    IMPLEMENTS_RE.lastIndex = 0
    while ((m = IMPLEMENTS_RE.exec(body)) !== null) {
      for (const iface of m[1].split(",").map(s => s.trim()).filter(Boolean)) {
        const target = findSymbol(byFile, byName, c.file, iface)
        if (target) {
          edges.push({
            sourceFile: c.file,
            sourceSymbol: c.name,
            targetFile: target.file,
            targetSymbol: target.name,
            kind: "implement",
          })
        }
      }
    }
  }

  return dedupeEdges(edges)
}

function findLocalImport(content: string): { path: string; name?: string } | null {
  let m: RegExpExecArray | null
  LOCAL_IMPORT_RE.lastIndex = 0
  while ((m = LOCAL_IMPORT_RE.exec(content)) !== null) {
    return { path: m[1] }
  }
  REQUIRE_RE.lastIndex = 0
  while ((m = REQUIRE_RE.exec(content)) !== null) {
    return { path: m[2], name: m[1] }
  }
  return null
}

function groupByFile(chunks: Chunk[]): Record<string, Chunk[]> {
  const map: Record<string, Chunk[]> = {}
  for (const c of chunks) {
    ;(map[c.file] ||= []).push(c)
  }
  return map
}

function findSymbol(byFile: Record<string, Chunk[]>, byName: Map<string, Chunk[]>, sourceFile: string, name: string): Chunk | null {
  const sameFile = byFile[sourceFile] || []
  for (const c of sameFile) {
    if (c.name === name && isSymbolType(c.type)) return c
  }
  const candidates = byName.get(name)
  if (candidates) return candidates[0]
  return null
}

function isSymbolType(t: string): boolean {
  return t === "function" || t === "class" || t === "interface" || t === "type"
}

function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>()
  return edges.filter(e => {
    const key = `${e.sourceFile}|${e.sourceSymbol}|${e.targetFile}|${e.targetSymbol}|${e.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
