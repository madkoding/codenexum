import type { Chunk } from "../types"

export function rbParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  let currentClass: string | null = null
  const lines = c.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    // class/module declaration (keyword-based, no reliable brace tracking)
    const cl = trimmed.match(/^(?:class|module)\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `${cl[0].split(/\s+/)[0]} ${currentClass}` })
      continue
    }

    // end keyword — might exit class scope (heuristic)
    if (trimmed === "end" && currentClass) {
      currentClass = null
      continue
    }

    // Method definition
    const fn = trimmed.match(/^def\s+(?:self\.)?(\w+)[\.\!\?]?\s*(?:\(([^)]*)\))?/)
    if (fn) {
      const name = currentClass ? `${currentClass}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      r.push({ id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1, content: `${prefix}def ${name}(${fn[2] || ""})` })
      continue
    }

    // require / include / extend
    const req = trimmed.match(/^require\s+['"]([^'"]+)['"]/)
    if (req) {
      r.push({ id: `${f}:imp:${req[1]}`, file: f, name: req[1], type: "import", line: i + 1, content: trimmed })
      continue
    }
    const incl = trimmed.match(/^(?:include|extend)\s+(\w+)/)
    if (incl) {
      r.push({ id: `${f}:imp:${incl[1]}`, file: f, name: incl[1], type: "import", line: i + 1, content: trimmed })
    }
  }

  return r
}