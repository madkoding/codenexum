import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function cppParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const fn = /(?:^|\n)\s*(?:template\s*<[^>]+>\s*)?(?:static\s+|inline\s+|extern\s+|constexpr\s+)*(?:\w+\s*\*?\s+)+(\w+)\s*\(([^)]*)\)\s*(?:const\s*|noexcept\s*)*\{/g
  while ((m = fn.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `${m[1]}(${m[2]})` })
  const cl = /(?:^|\n)\s*(?:template\s*<[^>]+>\s*)?(?:final\s+)?class\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+\w+(?:<[^>]+>)?)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `class ${m[1]}` })
  const st = /(?:^|\n)\s*(?:typedef\s+)?struct\s+(\w+)\s*\{/g
  while ((m = st.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `struct ${m[1]}` })
  const ns = /(?:^|\n)\s*namespace\s+(\w+)\s*\{/g
  while ((m = ns.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `namespace ${m[1]}` })
  const en = /(?:^|\n)\s*(?:enum\s+class\s+|enum\s+struct\s+|enum\s+)(\w+)(?::\s*\w+)?\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({ id: `${f}:enum:${m[1]}`, file: f, name: m[1], type: "enum", line: lineOf(c, m.index), content: `enum ${m[1]}` })
  return r
}