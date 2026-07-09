import type { Chunk } from "../types"

export function rsParse(c: string, f: string): Chunk[] {
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

    // Struct
    const st = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/)
    if (st) {
      currentClass = st[1]; classDepth = prevDepth
      r.push({ id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: i + 1, content: `struct ${currentClass}` })
      continue
    }

    // Enum
    const en = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/)
    if (en) {
      currentClass = en[1]; classDepth = prevDepth
      r.push({ id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1, content: `enum ${en[1]}` })
      continue
    }

    // Trait
    const tr = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/)
    if (tr) {
      currentClass = tr[1]; classDepth = prevDepth
      r.push({ id: `${f}:iface:${tr[1]}`, file: f, name: tr[1], type: "interface", line: i + 1, content: `trait ${tr[1]}` })
      continue
    }

    // impl block — sets current class scope for contained methods
    const imp = trimmed.match(/^impl\b(?:\s*<[^>]*>)?\s+(?:(\w+)(?:<[^>]*>)?\s+)?(?:for\s+(\w+))?/)
    if (imp && (imp[1] || imp[2])) {
      currentClass = imp[2] || imp[1]; classDepth = prevDepth
      continue
    }

    // Function/method
    const fn = trimmed.match(/^(?:pub\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:\s*<[^>]+>)?\s*\(([^)]*)\)/)
    if (fn) {
      const name = currentClass ? `${currentClass}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      r.push({ id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1, content: `${prefix}fn ${name}(${fn[2]})` })
      continue
    }

    // Import / use
    const use = trimmed.match(/^use\s+(?:\w+::)*(\w+)(?:::\*)?(?:\s+as\s+(\w+))?/)
    if (use) {
      const name = use[2] || use[1]
      r.push({ id: `${f}:imp:${name}`, file: f, name, type: "import", line: i + 1, content: trimmed })
      continue
    }
    const ext = trimmed.match(/^extern\s+crate\s+(\w+)/)
    if (ext) {
      r.push({ id: `${f}:imp:${ext[1]}`, file: f, name: ext[1], type: "import", line: i + 1, content: trimmed })
      continue
    }
    // pub use / pub mod (exports)
    const pubUse = trimmed.match(/^pub\s+use\s+(?:\w+::)*(\w+)/)
    if (pubUse) {
      r.push({ id: `${f}:exp:${pubUse[1]}`, file: f, name: pubUse[1], type: "export", line: i + 1, content: trimmed })
      continue
    }
    const pubMod = trimmed.match(/^pub\s+mod\s+(\w+)/)
    if (pubMod) {
      r.push({ id: `${f}:exp:${pubMod[1]}`, file: f, name: pubMod[1], type: "export", line: i + 1, content: trimmed })
    }
  }

  return r
}