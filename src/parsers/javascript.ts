import type { Chunk } from "../types"
import { findBlockEndByBrace, bodyOf, makeChunk, getLang, createLineResolver } from "./common"

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

export function jsParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const lines = c.split("\n")
  const lang = getLang(".js")

  const { lineOf } = createLineResolver(c)
  const fn = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g
  while ((m = fn.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(m.index), content: `function ${m[1]}(${m[2]})` }, lines, f))

  const af = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|(\w+))\s*=>/g
  while ((m = af.exec(c)) !== null) {
    // Arrow functions may end at semicolon instead of brace for single-expression bodies
    const line = lineOf(m.index)
    const endLine = findArrowEnd(lines, line - 1)
    r.push(makeChunk({
      id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line,
      content: `const ${m[1]} = (${m[2] || m[3] || ""}) =>`,
      lineEnd: endLine + 1,
    }, f, bodyOf(lines, line - 1, endLine)))
  }

  const cl = /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:cls:${m[1]}`, file: f, name: m[1], type: "class", line: lineOf(m.index), content: `class ${m[1]}` }, lines, f))

  const mt = /(?:^|\n)\s*(?:(?:public|private|protected|static|async|get|set|accessor|readonly)\s+)*(?!if|while|for|switch|catch|else|return|throw|case|typeof|new|import|export|function|class|interface|type|enum|const|let|var|await)(\w+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{/g
  while ((m = mt.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(m.index), content: `method ${m[1]}(${m[2]})` }, lines, f))

  const im1 = /(?:^|\n)\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  while ((m = im1.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(m.index), content: m[0].trim() }, f))

  const im2 = /(?:^|\n)\s*import\s+\{\s*(\w+)[^}]*\}\s+from\s+['"]([^'"]+)['"]/g
  while ((m = im2.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(m.index), content: m[0].trim() }, f))

  const im3 = /(?:^|\n)\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  while ((m = im3.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(m.index), content: m[0].trim() }, f))

  const im4 = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  while ((m = im4.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(m.index), content: m[0].trim() }, f))

  const im5 = /(?:^|\n)\s*(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = im5.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(m.index), content: m[0].trim() }, f))

  const ex1 = /(?:^|\n)\s*export\s+(?:default\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/g
  while ((m = ex1.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:exp:${m[1]}`, file: f, name: m[1], type: "export", line: lineOf(m.index), content: m[0].trim() }, f))

  const ex2 = /(?:^|\n)\s*export\s+\{\s*(\w+)/g
  while ((m = ex2.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:exp:${m[1]}`, file: f, name: m[1], type: "export", line: lineOf(m.index), content: m[0].trim() }, f))

  const ex3 = /(?:^|\n)\s*export\s+\*\s+from\s+['"][^'"]+['"]/g
  while ((m = ex3.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:exp:*`, file: f, name: "*", type: "export", line: lineOf(m.index), content: m[0].trim() }, f))

  const ex4 = /(?:^|\n)\s*export\s+default\s+(\w+)/g
  while ((m = ex4.exec(c)) !== null) {
    const name = m[1]
    if (!["function", "class", "interface", "type", "enum"].includes(name))
      r.push(makeChunk({ id: `${f}:exp:${name}`, file: f, name, type: "export", line: lineOf(m.index), content: m[0].trim() }, f))
  }

  const dec = /(?:^|\n)\s*@(\w+)(?:\s*\(([^)]*)\))?/g
  while ((m = dec.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:dec:${m[1]}`, file: f, name: m[1], type: "decorator", line: lineOf(m.index), content: `@${m[1]}${m[2] ? `(${m[2]})` : ""}` }, f))

  return r
}

function findArrowEnd(lines: string[], startLine: number): number {
  const line = lines[startLine] || ""
  // Single-line arrow function ending with semicolon or newline
  if (/=>\s*[^;{}]+$/.test(line) || /=\u003e\s*[^;{}]*;\s*$/.test(line)) return startLine
  // Expression spanning multiple lines until semicolon
  for (let i = startLine; i < lines.length; i++) {
    if (/;\s*$/.test(lines[i])) return i
    if (/\{\s*$/.test(lines[i])) return findBlockEndByBrace(lines, i)
  }
  return lines.length - 1
}

export function tsParse(c: string, f: string): Chunk[] {
  const r = jsParse(c, f); let m: RegExpExecArray | null
  const lines = c.split("\n")

  const { lineOf } = createLineResolver(c)
  const iface = /(?:^|\n)\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:iface:${m[1]}`, file: f, name: m[1], type: "interface", line: lineOf(m.index), content: `interface ${m[1]}` }, lines, f))

  const ta = /(?:^|\n)\s*(?:export\s+)?type\s+(\w+)\s*=/g
  while ((m = ta.exec(c)) !== null) {
    const line = lineOf(m.index)
    const endLine = findTypeEnd(lines, line - 1)
    r.push(makeChunk({
      id: `${f}:type:${m[1]}`, file: f, name: m[1], type: "type", line,
      content: `type ${m[1]}`,
      lineEnd: endLine + 1,
    }, f, bodyOf(lines, line - 1, endLine)))
  }

  const en = /(?:^|\n)\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push(makeRegexChunk({ id: `${f}:enum:${m[1]}`, file: f, name: m[1], type: "enum", line: lineOf(m.index), content: `enum ${m[1]}` }, lines, f))

  return r
}

function findTypeEnd(lines: string[], startLine: number): number {
  const line = lines[startLine] || ""
  if (/;\s*$/.test(line)) return startLine
  if (/\{\s*$/.test(line)) return findBlockEndByBrace(lines, startLine)
  // Type alias spanning lines until semicolon
  for (let i = startLine; i < lines.length; i++) {
    if (/;\s*$/.test(lines[i])) return i
  }
  return lines.length - 1
}
