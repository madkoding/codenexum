import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function javaParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const cl = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|static\s+)*class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `class ${m[1]}` })
  const md = /(?:^|\n)\s*(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?\s+)?(\w+)\s*\(([^)]*)\)\s*(?:throws\s+\w+(?:,\s*\w+)*)?\s*\{/g
  while ((m = md.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `method ${m[1]}(${m[2]})` })
  const iface = /(?:^|\n)\s*(?:public\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({ id: `${f}:iface:${m[1]}`, file: f, name: m[1], type: "interface", line: lineOf(c, m.index), content: `interface ${m[1]}` })
  const en = /(?:^|\n)\s*(?:public\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({ id: `${f}:enum:${m[1]}`, file: f, name: m[1], type: "enum", line: lineOf(c, m.index), content: `enum ${m[1]}` })
  return r
}