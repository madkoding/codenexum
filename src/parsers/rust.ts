import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function rsParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const fn = /(?:^|\n)\s*(?:pub\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:\s*<[^>]+>)?\s*\(([^)]*)\)(?:\s*->\s*[^{]+)?\s*\{/g
  while ((m = fn.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `fn ${m[1]}(${m[2]})` })
  const st = /(?:^|\n)\s*(?:pub\s+)?struct\s+(\w+)(?:<[^>]+>)?\s*(?:\{|$)/g
  while ((m = st.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `struct ${m[1]}` })
  const en = /(?:^|\n)\s*(?:pub\s+)?enum\s+(\w+)(?:<[^>]+>)?\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({ id: `${f}:enum:${m[1]}`, file: f, name: m[1], type: "enum", line: lineOf(c, m.index), content: `enum ${m[1]}` })
  const tr = /(?:^|\n)\s*(?:pub\s+)?trait\s+(\w+)(?:<[^>]+>)?\s*\{/g
  while ((m = tr.exec(c)) !== null)
    r.push({ id: `${f}:iface:${m[1]}`, file: f, name: m[1], type: "interface", line: lineOf(c, m.index), content: `trait ${m[1]}` })
  return r
}