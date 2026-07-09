import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function csParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const md = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+|internal\s+)?(?:static\s+|virtual\s+|override\s+|abstract\s+|async\s+|sealed\s+)*\w+(?:<[^>]+>)?\s+(\w+)\s*\(([^)]*)\)\s*\{/g
  while ((m = md.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `${m[1]}(${m[2]})` })
  const cl = /(?:^|\n)\s*(?:public\s+|internal\s+|abstract\s+|sealed\s+|static\s+)*class\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*[\w,\s<>\.]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `class ${m[1]}` })
  const iface = /(?:^|\n)\s*(?:public\s+|internal\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*[\w,\s<>\.]+)?(?:\s*where\s+\w+\s*:\s*[^{]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({ id: `${f}:iface:${m[1]}`, file: f, name: m[1], type: "interface", line: lineOf(c, m.index), content: `interface ${m[1]}` })
  const st = /(?:^|\n)\s*(?:public\s+|internal\s+)?struct\s+(\w+)(?:<[^>]+>)?\s*\{/g
  while ((m = st.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `struct ${m[1]}` })
  const en = /(?:^|\n)\s*(?:public\s+|internal\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({ id: `${f}:enum:${m[1]}`, file: f, name: m[1], type: "enum", line: lineOf(c, m.index), content: `enum ${m[1]}` })
  return r
}