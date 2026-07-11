import type { Chunk } from "../types"
import { findBlockEndByBrace, bodyOf, makeChunk, getLang } from "./common"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

function makeRegexChunk(
  partial: Omit<Chunk, "lineEnd" | "body" | "lang"> & { line: number; content: string },
  lines: string[],
  file: string,
): Chunk {
  const endLine = findBlockEndByBrace(lines, partial.line - 1)
  return makeChunk({
    ...partial,
    lineEnd: endLine + 1,
  }, file, bodyOf(lines, partial.line - 1, endLine))
}

export function goParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const lines = c.split("\n")

  const fn = /(?:^|\n)\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\([^)]*\)|\s+\w+(?:\s*\*?\w+)?)?\s*\{/g
  while ((m = fn.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `func ${m[1]}(${m[2]})` }, lines, f))

  const st = /(?:^|\n)\s*type\s+(\w+)\s+struct\s*\{/g
  while ((m = st.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `struct ${m[1]}` }, lines, f))

  const iface = /(?:^|\n)\s*type\s+(\w+)\s+interface\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:iface:${m[1]}`, file: f, name: m[1], type: "interface", line: lineOf(c, m.index), content: `interface ${m[1]}` }, lines, f))

  const im = /(?:^|\n)\s*import\s+(?:\(?\s*['"]([^'"]+)['"]|\w+\s+['"]([^'"]+)['"])/g
  while ((m = im.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:imp:${m[1] || m[2]}`, file: f, name: m[1] || m[2], type: "import", line: lineOf(c, m.index), content: m[0].trim() }, f))

  return r
}
