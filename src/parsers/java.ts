import type { Chunk } from "../types"
import { findBlockEndByBrace, bodyOf, makeChunk, getLang, countRealBraces } from "./common"

export function javaParse(c: string, f: string): Chunk[] {
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

    const ann = trimmed.match(/^@(\w+)(?:\s*\(([^)]*)\))?/)
    if (ann) {
      r.push(makeChunk({ id: `${f}:dec:${ann[1]}`, file: f, name: ann[1], type: "decorator", line: i + 1, content: trimmed }, f))
      continue
    }

    const cl = trimmed.match(/^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|static\s+)*class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth; currentClassStart = i
      continue
    }

    const iface = trimmed.match(/^(?:public\s+)?interface\s+(\w+)/)
    if (iface) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:iface:${iface[1]}`, file: f, name: iface[1], type: "interface", line: i + 1,
        content: `interface ${iface[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const en = trimmed.match(/^(?:public\s+)?enum\s+(\w+)/)
    if (en) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1,
        content: `enum ${en[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const md = trimmed.match(/^(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:\s*<[^\u003e]+\u003e)?\s+)?(\w+)\s*\(([^)]*)\)/)
    if (md) {
      const name = currentClass ? `${currentClass}.${md[1]}` : md[1]
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1,
        content: `method ${name}(${md[2]})`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const im = trimmed.match(/^import\s+(?:static\s+)?(?:\w+\.)*(\w+)/)
    if (im) {
      const name = im[1]
      if (name !== "*")
        r.push(makeChunk({ id: `${f}:imp:${name}`, file: f, name, type: "import", line: i + 1, content: trimmed }, f))
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
