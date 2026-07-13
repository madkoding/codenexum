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
          edges.push({ sourceFile: c.file, sourceSymbol: local.name, targetFile, targetSymbol: local.name, kind: "import" })
        }
      }
    }
  }

  for (const c of chunks) {
    if (c.type === "import" || c.type === "decorator" || c.type === "config") continue
    const body = c.body || c.content
    const calls = body.matchAll(CALL_RE)
    for (const m of calls) {
      const name = m[1]
      if (JS_KEYWORDS.has(name)) continue
      const targets = byName.get(name)
      if (targets) {
        for (const t of targets) {
          if (t.file !== c.file) {
            edges.push({ sourceFile: c.file, sourceSymbol: c.name, targetFile: t.file, targetSymbol: name, kind: "call" })
          }
        }
      }
    }

    const extendsMatch = body.match(EXTENDS_RE)
    if (extendsMatch) {
      const name = extendsMatch[1]
      const targets = byName.get(name)
      if (targets) {
        for (const t of targets) {
          if (t.file !== c.file) {
            edges.push({ sourceFile: c.file, sourceSymbol: c.name, targetFile: t.file, targetSymbol: name, kind: "extend" })
          }
        }
      }
    }

    const implMatch = body.match(IMPLEMENTS_RE)
    if (implMatch && implMatch[1]) {
      const names = implMatch[1].split(",").map(s => s.trim())
      for (const name of names) {
        const targets = byName.get(name)
        if (targets) {
          for (const t of targets) {
            if (t.file !== c.file) {
              edges.push({ sourceFile: c.file, sourceSymbol: c.name, targetFile: t.file, targetSymbol: name, kind: "implement" })
            }
          }
        }
      }
    }
  }

  return edges
}

function groupByFile(chunks: Chunk[]): Map<string, Chunk[]> {
  const map = new Map<string, Chunk[]>()
  for (const c of chunks) {
    let a = map.get(c.file)
    if (!a) { a = []; map.set(c.file, a) }
    a.push(c)
  }
  return map
}

function isSymbolType(type: string): boolean {
  return type === "function" || type === "class" || type === "interface" || type === "type" || type === "enum"
}

interface LocalImport {
  name: string
  path: string
}

function findLocalImport(content: string): LocalImport | null {
  const m = content.match(LOCAL_IMPORT_RE)
  if (m) {
    const path = m[1]
    if (!path) return null
    const nameMatch = content.match(/import\s+(?:\*\s+as\s+)?(\w+)/)
    const name = nameMatch ? nameMatch[1] : path.split("/").pop() || "unknown"
    return { name, path }
  }
  const m2 = content.match(REQUIRE_RE)
  if (m2) {
    return { name: m2[1], path: m2[2] }
  }
  return null
}
