import type { Chunk } from "../types"
import { bodyOf, makeChunk, getLang } from "./common"

export function rsParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  let currentClass: { name: string; type: "class" | "interface" | "enum"; start: number; content: string } | null = null
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

    if (currentClass && depth <= classDepth) {
      r.push(makeChunk({
        id: `${f}:cls:${currentClass.name}`, file: f, name: currentClass.name, type: currentClass.type, line: currentClass.start + 1,
        content: currentClass.content,
        lineEnd: i + 1,
      }, f, bodyOf(lines, currentClass.start, i)))
      currentClass = null
    }

    const st = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/)
    if (st) {
      const hasBody = trimmed.includes("{")
      if (hasBody) {
        currentClass = { name: st[1], type: "class", start: i, content: `struct ${st[1]}` }
        classDepth = prevDepth
      } else {
        r.push(makeChunk({ id: `${f}:cls:${st[1]}`, file: f, name: st[1], type: "class", line: i + 1, content: `struct ${st[1]}`, lineEnd: i + 1 }, f, line))
      }
      continue
    }

    const en = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/)
    if (en) {
      const hasBody = trimmed.includes("{")
      if (hasBody) {
        currentClass = { name: en[1], type: "enum", start: i, content: `enum ${en[1]}` }
        classDepth = prevDepth
      } else {
        r.push(makeChunk({ id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1, content: `enum ${en[1]}`, lineEnd: i + 1 }, f, line))
      }
      continue
    }

    const tr = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/)
    if (tr) {
      const hasBody = trimmed.includes("{")
      if (hasBody) {
        currentClass = { name: tr[1], type: "interface", start: i, content: `trait ${tr[1]}` }
        classDepth = prevDepth
      } else {
        r.push(makeChunk({ id: `${f}:iface:${tr[1]}`, file: f, name: tr[1], type: "interface", line: i + 1, content: `trait ${tr[1]}`, lineEnd: i + 1 }, f, line))
      }
      continue
    }

    const imp = trimmed.match(/^impl\b(?:\s*<[^\u003e]*\u003e)?\s+(?:(\w+)(?:\s*<[^\u003e]*\u003e)?\s+)?(?:for\s+(\w+))?/)
    if (imp && (imp[1] || imp[2])) {
      const name = imp[2] || imp[1]!
      currentClass = { name, type: "class", start: i, content: `impl ${name}` }
      classDepth = prevDepth
      continue
    }

    const fn = trimmed.match(/^(?:pub\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:\s*<[^\u003e]+\u003e)?\s*\(([^)]*)\)/)
    if (fn) {
      const name = currentClass ? `${currentClass.name}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      const endLine = findRustBlockEnd(lines, i)
      r.push(makeChunk({
        id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1,
        content: `${prefix}fn ${name}(${fn[2]})`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const use = trimmed.match(/^use\s+(?:\w+::)*(\w+)(?:::{\u0026|\*})?(?:\s+as\s+(\w+))?/)
    if (use) {
      const name = use[2] || use[1]
      r.push(makeChunk({ id: `${f}:imp:${name}`, file: f, name, type: "import", line: i + 1, content: trimmed }, f))
      continue
    }

    const ext = trimmed.match(/^extern\s+crate\s+(\w+)/)
    if (ext) {
      r.push(makeChunk({ id: `${f}:imp:${ext[1]}`, file: f, name: ext[1], type: "import", line: i + 1, content: trimmed }, f))
      continue
    }

    const pubUse = trimmed.match(/^pub\s+use\s+(?:\w+::)*(\w+)/)
    if (pubUse) {
      r.push(makeChunk({ id: `${f}:exp:${pubUse[1]}`, file: f, name: pubUse[1], type: "export", line: i + 1, content: trimmed }, f))
      continue
    }

    const pubMod = trimmed.match(/^pub\s+mod\s+(\w+)/)
    if (pubMod) {
      r.push(makeChunk({ id: `${f}:exp:${pubMod[1]}`, file: f, name: pubMod[1], type: "export", line: i + 1, content: trimmed }, f))
    }
  }

  // Close any open class at EOF
  if (currentClass) {
    r.push(makeChunk({
      id: `${f}:cls:${currentClass.name}`, file: f, name: currentClass.name, type: currentClass.type, line: currentClass.start + 1,
      content: currentClass.content,
      lineEnd: lines.length,
    }, f, bodyOf(lines, currentClass.start, lines.length - 1)))
  }

  return r
}

function findRustBlockEnd(lines: string[], startLine: number): number {
  let depth = 0
  let started = false
  let inString: string | null = null
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (inString) {
        if (ch === inString) inString = null
        continue
      }
      if (ch === '"' || ch === "'") {
        inString = ch
        continue
      }
      if (ch === "{") {
        if (!started) started = true
        depth++
      } else if (ch === "}") {
        depth--
        if (started && depth <= 0) return i
      }
    }
  }
  return lines.length - 1
}
