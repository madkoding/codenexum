import type { Chunk } from "../types"
import { findBlockEndByIndent, bodyOf, makeChunk, getLang } from "./common"

export function pyParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []
  const classStack: { name: string; indent: number; line: number }[] = []
  const lines = c.split("\n")
  const lang = getLang(".py")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const indent = line.length - trimmed.length

    // Pop classes whose body we've exited (current indent <= class indent)
    while (classStack.length > 0 && indent <= classStack[classStack.length - 1].indent)
      classStack.pop()

    // Decorator
    const dec = trimmed.match(/^@(\w+)(?:\.\w+)*(?:\s*\(([^)]*)\))?/)
    if (dec) {
      r.push(makeChunk({ id: `${f}:dec:${dec[1]}`, file: f, name: dec[1], type: "decorator", line: i + 1, content: trimmed }, f))
      continue
    }

    // Class declaration
    const cl = trimmed.match(/^class\s+(\w+)\s*(\([^)]*\))?\s*:/)
    if (cl) {
      const endLine = findBlockEndByIndent(lines, i)
      classStack.push({ name: cl[1], indent, line: i })
      r.push(makeChunk({
        id: `${f}:cls:${cl[1]}`, file: f, name: cl[1], type: "class", line: i + 1,
        content: `class ${cl[1]}${cl[2] || ""}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    // Function/method declaration
    const fn = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[^:]+)?\s*:/)
    if (fn) {
      const endLine = findBlockEndByIndent(lines, i)
      const name = classStack.length > 0 ? `${classStack[classStack.length - 1].name}.${fn[1]}` : fn[1]
      const prefix = classStack.length > 0 ? "method " : ""
      r.push(makeChunk({
        id: `${f}:fn:${name}`, file: f, name, type: "function", line: i + 1,
        content: `${prefix}def ${name}(${fn[2]})${fn[3] || ""}`,
        lineEnd: endLine + 1,
      }, f, bodyOf(lines, i, endLine)))
      continue
    }

    // Import statements
    const im1 = trimmed.match(/^import\s+(\w+)/)
    if (im1) {
      r.push(makeChunk({ id: `${f}:imp:${im1[1]}`, file: f, name: im1[1], type: "import", line: i + 1, content: trimmed }, f))
      continue
    }
    const im2 = trimmed.match(/^from\s+(\S+)\s+import\s+(\w+)/)
    if (im2) {
      r.push(makeChunk({ id: `${f}:imp:${im2[2]}`, file: f, name: im2[2], type: "import", line: i + 1, content: trimmed }, f))
    }
  }

  return r
}
