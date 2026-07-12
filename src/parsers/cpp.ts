import type { Chunk } from "../types"
import { findBlockEndByBrace, bodyOf, makeChunk, getLang, countRealBraces } from "./common"

export function cppParse(c: string, f: string): Chunk[] {
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

    if (trimmed.startsWith("template")) continue

    const cl = trimmed.match(/^(?:final\s+)?class\s+(\w+)/)
    if (cl) {
      currentClass = cl[1]; classDepth = prevDepth; currentClassStart = i
      continue
    }

    const st = trimmed.match(/^struct\s+(\w+)/)
    if (st && !trimmed.startsWith("typedef")) {
      currentClass = st[1]; classDepth = prevDepth; currentClassStart = i
      continue
    }

    const ns = trimmed.match(/^namespace\s+(\w+)/)
    if (ns && !trimmed.includes("=")) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:cls:${ns[1]}`, file: f, name: ns[1], type: "class", line: i + 1,
        content: `namespace ${ns[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const en = trimmed.match(/^(?:enum\s+class\s+|enum\s+struct\s+|enum\s+)(\w+)/)
    if (en) {
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:enum:${en[1]}`, file: f, name: en[1], type: "enum", line: i + 1,
        content: `enum ${en[1]}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const fn = trimmed.match(/^(?:(?:static|inline|extern|constexpr|virtual|override|const|noexcept)\s+)*(?:\w+(?:\s*\*?\s*|\s+&?)+\s*)?(?!if|while|for|switch|return|catch)(\w+)\s*\(([^)]*)\)\s*(?:const|noexcept|override|final)*\s*\{/)
    if (fn) {
      const name = currentClass ? `${currentClass}.${fn[1]}` : fn[1]
      const prefix = currentClass ? "method " : ""
      const endLine = findBlockEndByBrace(lines, i)
      r.push(makeChunk({
        id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1,
        content: `${prefix}${name}(${fn[2]})`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const inc = trimmed.match(/^#include\s+[<"]([^\u003e"]+)[\">]/)
    if (inc) {
      r.push(makeChunk({ id: `${f}:imp:${inc[1]}`, file: f, name: inc[1], type: "import", line: i + 1, content: trimmed }, f))
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
