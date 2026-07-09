import type { Chunk } from "../types"

export function phpParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  let currentClass: string | null = null
  let depth = 0
  let classDepth = -1
  const lines = c.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    const prevDepth = depth
    for (const ch of line) {
      if (ch === "{") depth++
      if (ch === "}") depth--
    }

    if (currentClass && depth <= classDepth) currentClass = null

    // Class
    const cl = trimmed.match(/^(?:final\s+|abstract\s+)?class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `class ${currentClass}` })
      continue
    }

    // Interface
    const iface = trimmed.match(/^interface\s+(\w+)/)
    if (iface) {
      r.push({ id: `${f}:iface:${iface[1]}`, file: f, name: iface[1], type: "interface", line: i + 1, content: `interface ${iface[1]}` })
      continue
    }

    // Trait
    const tr = trimmed.match(/^trait\s+(\w+)/)
    if (tr) {
      r.push({ id: `${f}:iface:${tr[1]}`, file: f, name: tr[1], type: "interface", line: i + 1, content: `trait ${tr[1]}` })
      continue
    }

    // Enum
    const en = trimmed.match(/^enum\s+(\w+)/)
    if (en) {
      r.push({ id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1, content: `enum ${en[1]}` })
      continue
    }

    // Function/method
    const fn = trimmed.match(/^(?:(?:public|private|protected)\s+)?(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/)
    if (fn) {
      const name = currentClass ? `${currentClass}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      r.push({ id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1, content: `${prefix}function ${name}(${fn[2]})` })
      continue
    }

    // use / require / include
    const use = trimmed.match(/^use\s+(\w+)/)
    if (use && !trimmed.includes("function") && !trimmed.includes("const")) {
      r.push({ id: `${f}:imp:${use[1]}`, file: f, name: use[1], type: "import", line: i + 1, content: trimmed })
      continue
    }
    const req = trimmed.match(/^(?:require|include)(?:_once)?\s+['"][^'"]+['"]/)
    if (req) {
      r.push({ id: `${f}:imp:file`, file: f, name: "file", type: "import", line: i + 1, content: trimmed })
    }
  }

  return r
}