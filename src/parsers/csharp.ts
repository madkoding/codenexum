import type { Chunk } from "../types"
import { findBlockEndByBrace, bodyOf, makeChunk, getLang, countRealBraces } from "./common"

export function csParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  let currentClass: string | null = null
  let currentClassStart = -1
  let depth = 0
  let classDepth = -1
  let recordDepth = -1
  const lines = c.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    const prevDepth = depth
    const b = countRealBraces(line)
    depth += b.open - b.close

    if (currentClass && depth <= classDepth && depth <= recordDepth) {
      r.push(makeChunk({
        id: `${f}:cls:${currentClass}`, file: f, name: currentClass, type: "class", line: currentClassStart + 1,
        content: `class ${currentClass}`,
        lineEnd: i + 1,
      }, f, bodyOf(lines, currentClassStart, i)))
      currentClass = null
      currentClassStart = -1
      recordDepth = -1
    }

    const cl = trimmed.match(/^(?:public\s+|internal\s+|abstract\s+|sealed\s+|static\s+)*class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth; currentClassStart = i; recordDepth = prevDepth
      continue
    }

    const st = trimmed.match(/^(?:public\s+|internal\s+)?struct\s+(\w+)/)
    if (st) {
      currentClass = st[1]; classDepth = prevDepth; currentClassStart = i; recordDepth = prevDepth
      continue
    }

    const rc = trimmed.match(/^(?:public\s+|internal\s+)?record\s+(\w+)/)
    if (rc) {
      currentClass = rc[1]; classDepth = prevDepth; currentClassStart = i; recordDepth = prevDepth
      continue
    }

    const iface = trimmed.match(/^(?:public\s+|internal\s+)?interface\s+(\w+)/)
    if (iface) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:iface:${iface[1]}`, file: f, name: iface[1], type: "interface", line: i + 1,
        content: `interface ${iface[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const en = trimmed.match(/^(?:public\s+|internal\s+)?enum\s+(\w+)/)
    if (en) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1,
        content: `enum ${en[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const md = trimmed.match(/^(?:(?:public|private|protected|internal)\s+)?(?:(?:static|virtual|override|abstract|async|sealed)\s+)*\w+(?:\s*<[^\u003e]+\u003e)?\s+(\w+)\s*\(([^)]*)\)/)
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

    const us = trimmed.match(/^using\s+(?:static\s+)?(?:\w+\.)*(\w+)/)
    if (us) {
      const name = us[1]
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
