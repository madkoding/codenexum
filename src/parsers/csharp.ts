import type { Chunk } from "../types"

export function csParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  let currentClass: string | null = null
  let depth = 0
  let classDepth = -1
  let recordDepth = -1
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

    if (currentClass && depth <= classDepth && depth <= recordDepth) currentClass = null

    // Class
    const cl = trimmed.match(/^(?:public\s+|internal\s+|abstract\s+|sealed\s+|static\s+)*class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `class ${currentClass}` })
      continue
    }

    // Struct (acts like class for method scope)
    const st = trimmed.match(/^(?:public\s+|internal\s+)?struct\s+(\w+)/)
    if (st) {
      currentClass = st[1]; classDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `struct ${currentClass}` })
      continue
    }

    // Record
    const rc = trimmed.match(/^(?:public\s+|internal\s+)?record\s+(\w+)/)
    if (rc) {
      currentClass = rc[1]; classDepth = prevDepth; recordDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `record ${currentClass}` })
      continue
    }

    // Interface
    const iface = trimmed.match(/^(?:public\s+|internal\s+)?interface\s+(\w+)/)
    if (iface) {
      r.push({ id: `${f}:iface:${iface[1]}`, file: f, name: iface[1], type: "interface", line: i + 1, content: `interface ${iface[1]}` })
      continue
    }

    // Enum
    const en = trimmed.match(/^(?:public\s+|internal\s+)?enum\s+(\w+)/)
    if (en) {
      r.push({ id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1, content: `enum ${en[1]}` })
      continue
    }

    // Method/property
    const md = trimmed.match(/^(?:(?:public|private|protected|internal)\s+)?(?:(?:static|virtual|override|abstract|async|sealed)\s+)*\w+(?:<[^>]+>)?\s+(\w+)\s*\(([^)]*)\)/)
    if (md) {
      const name = currentClass ? `${currentClass}.${md[1]}` : md[1]
      r.push({ id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1, content: `method ${name}(${md[2]})` })
      continue
    }

    // using directive
    const us = trimmed.match(/^using\s+(?:static\s+)?(?:\w+\.)*(\w+)/)
    if (us) {
      const name = us[1]
      if (name !== "*")
        r.push({ id: `${f}:imp:${name}`, file: f, name, type: "import", line: i + 1, content: trimmed })
    }
  }

  return r
}