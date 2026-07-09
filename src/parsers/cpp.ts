import type { Chunk } from "../types"

export function cppParse(c: string, f: string): Chunk[] {
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

    // Template preamble — skip, the next line has the actual declaration
    if (trimmed.startsWith("template")) continue

    // Class
    const cl = trimmed.match(/^(?:final\s+)?class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `class ${currentClass}` })
      continue
    }

    // Struct
    const st = trimmed.match(/^struct\s+(\w+)/)
    if (st && !trimmed.startsWith("typedef")) {
      currentClass = st[1]; classDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `struct ${currentClass}` })
      continue
    }

    // Namespace (acts as scope)
    const ns = trimmed.match(/^namespace\s+(\w+)/)
    if (ns && !trimmed.includes("=")) {
      r.push({ id: `${f}:cls:${ns[1]}`, file: f, name: ns[1], type: "class", line: i + 1, content: `namespace ${ns[1]}` })
      continue
    }

    // Enum
    const en = trimmed.match(/^(?:enum\s+class\s+|enum\s+struct\s+|enum\s+)(\w+)/)
    if (en) {
      r.push({ id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1, content: `enum ${en[1]}` })
      continue
    }

    // Function/method — return_type name(args) { ... }
    const fn = trimmed.match(/^(?:(?:static|inline|extern|constexpr|virtual|override|const|noexcept)\s+)*(?:\w+(?:\s*\*?\s*|\s+&?)+\s*)?(\w+)\s*\(([^)]*)\)\s*(?:const|noexcept|override|final)*\s*\{/)
    if (fn) {
      const name = currentClass ? `${currentClass}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      r.push({ id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1, content: `${prefix}${name}(${fn[2]})` })
      continue
    }

    // #include
    const inc = trimmed.match(/^#include\s+[<"]([^>"]+)[>"]/)
    if (inc) {
      r.push({ id: `${f}:imp:${inc[1]}`, file: f, name: inc[1], type: "import", line: i + 1, content: trimmed })
    }
  }

  return r
}