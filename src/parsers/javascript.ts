import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

export function jsParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const fn = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g
  while ((m = fn.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `function ${m[1]}(${m[2]})` })
  const af = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|(\w+))\s*=>/g
  while ((m = af.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `const ${m[1]} = (${m[2] || m[3] || ""}) =>` })
  const cl = /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(c, m.index), content: `class ${m[1]}` })
  return r
}

export function tsParse(c: string, f: string): Chunk[] {
  const r = jsParse(c, f); let m: RegExpExecArray | null
  const iface = /(?:^|\n)\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({ id: `${f}:iface:${m[1]}`, file: f, name: m[1], type: "interface", line: lineOf(c, m.index), content: `interface ${m[1]}` })
  const ta = /(?:^|\n)\s*(?:export\s+)?type\s+(\w+)\s*=/g
  while ((m = ta.exec(c)) !== null)
    r.push({ id: `${f}:type:${m[1]}`, file: f, name: m[1], type: "type", line: lineOf(c, m.index), content: `type ${m[1]}` })
  const en = /(?:^|\n)\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({ id: `${f}:enum:${m[1]}`, file: f, name: m[1], type: "enum", line: lineOf(c, m.index), content: `enum ${m[1]}` })
  return r
}