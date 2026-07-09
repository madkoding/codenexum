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
  const mt = /(?:^|\n)\s*(?:(?:public|private|protected|static|async|get|set|accessor|readonly)\s+)*(?!if|while|for|switch|catch|else|return|throw|case|typeof|new|import|export|function|class|interface|type|enum|const|let|var|await)(\w+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{/g
  while ((m = mt.exec(c)) !== null)
    r.push({ id: `${f}:fn:${m[1]}`, file: f, name: m[1], type: "function", line: lineOf(c, m.index), content: `method ${m[1]}(${m[2]})` })
  // Import statements
  const im1 = /(?:^|\n)\s*import\s+(\w+)\s+from\s+['"][^'"]+['"]/g
  while ((m = im1.exec(c)) !== null)
    r.push({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(c, m.index), content: m[0].trim() })
  const im2 = /(?:^|\n)\s*import\s+\{\s*(\w+)/g
  while ((m = im2.exec(c)) !== null)
    r.push({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(c, m.index), content: m[0].trim() })
  const im3 = /(?:^|\n)\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]+['"]/g
  while ((m = im3.exec(c)) !== null)
    r.push({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(c, m.index), content: m[0].trim() })
  const im4 = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  while ((m = im4.exec(c)) !== null)
    r.push({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(c, m.index), content: m[0].trim() })
  const im5 = /(?:^|\n)\s*(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(['"][^'"]+['"]\)/g
  while ((m = im5.exec(c)) !== null)
    r.push({ id: `${f}:imp:${m[1]}`, file: f, name: m[1], type: "import", line: lineOf(c, m.index), content: m[0].trim() })
  // Export statements
  const ex1 = /(?:^|\n)\s*export\s+(?:default\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/g
  while ((m = ex1.exec(c)) !== null)
    r.push({ id: `${f}:exp:${m[1]}`, file: f, name: m[1], type: "export", line: lineOf(c, m.index), content: m[0].trim() })
  const ex2 = /(?:^|\n)\s*export\s+\{\s*(\w+)/g
  while ((m = ex2.exec(c)) !== null)
    r.push({ id: `${f}:exp:${m[1]}`, file: f, name: m[1], type: "export", line: lineOf(c, m.index), content: m[0].trim() })
  const ex3 = /(?:^|\n)\s*export\s+\*\s+from\s+['"][^'"]+['"]/g
  while ((m = ex3.exec(c)) !== null)
    r.push({ id: `${f}:exp:*`, file: f, name: "*", type: "export", line: lineOf(c, m.index), content: m[0].trim() })
  const ex4 = /(?:^|\n)\s*export\s+default\s+(\w+)/g
  while ((m = ex4.exec(c)) !== null) {
    const name = m[1]
    if (!["function", "class", "interface", "type", "enum"].includes(name))
      r.push({ id: `${f}:exp:${name}`, file: f, name, type: "export", line: lineOf(c, m.index), content: m[0].trim() })
  }
  // Decorators
  const dec = /(?:^|\n)\s*@(\w+)(?:\s*\(([^)]*)\))?/g
  while ((m = dec.exec(c)) !== null)
    r.push({ id: `${f}:dec:${m[1]}`, file: f, name: m[1], type: "decorator", line: lineOf(c, m.index), content: `@${m[1]}${m[2] ? `(${m[2]})` : ""}` })
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