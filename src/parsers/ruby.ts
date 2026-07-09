import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function rbParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const fn = /(?:^|\n)\s*def\s+(?:self\.)?(\w+)[\.\!\?]?\s*(?:\(([^)]*)\)|[^;\n]*)/g
  while ((m = fn.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `def ${m[1]}(${m[2] || ""})` })
  const cl = /(?:^|\n)\s*(?:class|module)\s+(\w+)(?:\s*<\s*\w+)?/g
  while ((m = cl.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `${m[0].trim().split(/\s+/)[0]} ${m[1]}` })
  return r
}