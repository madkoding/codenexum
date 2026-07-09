import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function pyParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const fn = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[^:]+)?\s*:/gm
  while ((m = fn.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[2]}`, file: f, name: m[2], type: "function", line: lineOf(c, m.index), content: `def ${m[2]}(${m[3]})${m[4] || ""}` })
  const cl = /^(\s*)class\s+(\w+)\s*(\([^)]*\))?\s*:/gm
  while ((m = cl.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[2]}`, file: f, name: m[2], type: "class", line: lineOf(c, m.index), content: `class ${m[2]}${m[3] || ""}` })
  return r
}