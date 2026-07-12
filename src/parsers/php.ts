import type { Chunk } from "../types"
import { findBlockEndByBrace, bodyOf, makeChunk, getLang, countRealBraces } from "./common"

export function phpParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  let currentClass: string | null = null
  let currentClassStart = -1
  let depth = 0
  let classDepth = -1
  const lines = c.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    const prevDepth = depth
    const b = countRealBraces(line)
    depth += b.open - b.close

    if (currentClass && depth <= classDepth) {
      r.push(makeChunk({
        id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: currentClassStart + 1,
        content: `class ${currentClass}`,
        lineEnd: i + 1,
      }, f, bodyOf(lines, currentClassStart, i)))
      currentClass = null
      currentClassStart = -1
    }

    const cl = trimmed.match(/^(?:final\s+|abstract\s+)?class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth; currentClassStart = i
      continue
    }

    const iface = trimmed.match(/^interface\s+(\w+)/)
    if (iface) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:iface:${iface[1]}`, file: f, name: iface[1], type: "interface", line: i + 1,
        content: `interface ${iface[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const tr = trimmed.match(/^trait\s+(\w+)/)
    if (tr) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:iface:${tr[1]}`, file: f, name: tr[1], type: "interface", line: i + 1,
        content: `trait ${tr[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const en = trimmed.match(/^enum\s+(\w+)/)
    if (en) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1,
        content: `enum ${en[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const fn = trimmed.match(/^(?:(?:public|private|protected)\s+)?(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/)
    if (fn) {
      const name = currentClass ? `${currentClass}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1,
        content: `${prefix}function ${name}(${fn[2]})`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const use = trimmed.match(/^use\s+(\w+)/)
    if (use && !trimmed.includes("function") && !trimmed.includes("const")) {
      r.push(makeChunk({ id: `${f}:imp:${use[1]}`, file: f, name: use[1], type: "import", line: i + 1, content: trimmed }, f))
      continue
    }

    const req = trimmed.match(/^(?:require|include)(?:_once)?\s+['"][^'"]+['"]/)
    if (req) {
      r.push(makeChunk({ id: `${f}:imp:file`, file: f, name: "file", type: "import", line: i + 1, content: trimmed }, f))
    }
  }

  if (currentClass && currentClassStart >= 0) {
    r.push(makeChunk({
      id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: currentClassStart + 1,
      content: `class ${currentClass}`,
      lineEnd: lines.length,
    }, f, bodyOf(lines, currentClassStart, lines.length - 1)))
  }

  return r
}
