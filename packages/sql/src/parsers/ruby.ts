import type { Chunk } from "../types"
import { findBlockEndByEndKeyword, bodyOf, makeChunk, getLang } from "./common"

export function rbParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  const classStack: { name: string; line: number; kind: string }[] = []
  const lines = c.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    const cl = trimmed.match(/^(class|module)\s+(\w+)/)
    if (cl) {
      classStack.push({ name: cl[2], line: i, kind: cl[1] })
      continue
    }

    if (trimmed === "end" && classStack.length > 0) {
      const cls = classStack.pop()!
      const name = cls.name
      r.push(makeChunk({
        id: `${f}:cls:${name}`, file: f, name, type: "class", line: cls.line + 1,
        content: `${cls.kind} ${name}`,
        lineEnd: i + 1,
      }, f, bodyOf(lines, cls.line, i)))
      continue
    }

    const fn = trimmed.match(/^def\s+(?:self\.)?(\w+)[\.\!\?]?\s*(?:\(([^)]*)\))?/)
    if (fn) {
      const endLine = findBlockEndByEndKeyword(lines, i)
      const name = classStack.length > 0 ? `${classStack[classStack.length - 1].name}.${fn[1]}` : fn[1]
      const prefix = classStack.length > 0 ? "method " : ""
      r.push(makeChunk({
        id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1,
        content: `${prefix}def ${name}(${fn[2] || ""})`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    const req = trimmed.match(/^require\s+['"]([^'"]+)['"]/)
    if (req) {
      r.push(makeChunk({ id: `${f}:imp:${req[1]}`, file: f, name: req[1], type: "import", line: i + 1, content: trimmed }, f))
      continue
    }

    const incl = trimmed.match(/^(?:include|extend)\s+(\w+)/)
    if (incl) {
      r.push(makeChunk({ id: `${f}:imp:${incl[1]}`, file: f, name: incl[1], type: "import", line: i + 1, content: trimmed }, f))
    }
  }

  // Close any open classes at EOF
  while (classStack.length > 0) {
    const cls = classStack.pop()!
    r.push(makeChunk({
      id: `${f}:cls:${cls.name}`, file: f, name: cls.name, type: "class", line: cls.line + 1,
      content: `class ${cls.name}`,
      lineEnd: lines.length,
    }, f, bodyOf(lines, cls.line, lines.length - 1)))
  }

  return r
}
