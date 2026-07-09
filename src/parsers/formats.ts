import type { Chunk } from "../types"

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}

// CSS / SCSS
export function cssParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const sel = /(?:^|\n)\s*(\.-?[_a-zA-Z][\w-]*|#-?[_a-zA-Z][\w-]*)/g
  while ((m = sel.exec(c)) !== null)
    r.push({ id: `${f}:sel:${m[1]}`, file: f, name: m[1], type: "selector", line: lineOf(c, m.index), content: m[1] })
  const at = /(?:^|\n)\s*(@\w+)/g
  while ((m = at.exec(c)) !== null) {
    if (m[1] !== "@import") r.push({ id: `${f}:sel:${m[1]}`, file: f, name: m[1], type: "selector", line: lineOf(c, m.index), content: m[0].trim() })
  }
  const prop = /(?:^|\n)\s*(--[\w-]+)\s*:/g
  while ((m = prop.exec(c)) !== null)
    r.push({ id: `${f}:sel:${m[1]}`, file: f, name: m[1], type: "selector", line: lineOf(c, m.index), content: m[1] })
  return r
}

// HTML / HBS / EJS
export function htmlParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const comp = /<([A-Z]\w*)[\s>]/g
  while ((m = comp.exec(c)) !== null)
    r.push({ id: `${f}:cmp:${m[1]}`, file: f, name: m[1], type: "component", line: lineOf(c, m.index), content: m[0].trim() })
  const id = /\s(id|data-testid)=["']([^"']+)["']/g
  while ((m = id.exec(c)) !== null)
    r.push({ id: `${f}:cmp:${m[2]}`, file: f, name: m[2], type: "component", line: lineOf(c, m.index), content: m[0].trim() })
  return r
}

// JSON / YAML / TOML
export function dataParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  // JSON keys: "key":
  const jk = /(?:^|\n)\s*"(\w+)"\s*:/g
  while ((m = jk.exec(c)) !== null)
    r.push({ id: `${f}:cfg:${m[1]}`, file: f, name: m[1], type: "config", line: lineOf(c, m.index), content: m[1] })
  // YAML keys: key: (at line start or after indent)
  const yk = /(?:^|\n)(?:-\s+)?(\w[\w_-]*)\s*:(?:\s|\||>|$)/gm
  while ((m = yk.exec(c)) !== null)
    r.push({ id: `${f}:cfg:${m[1]}`, file: f, name: m[1], type: "config", line: lineOf(c, m.index), content: m[1] })
  // TOML sections: [section] or [parent.child]
  const ts = /(?:^|\n)\[(\w+(?:\.\w+)*)\]/g
  while ((m = ts.exec(c)) !== null)
    r.push({ id: `${f}:cfg:${m[1]}`, file: f, name: m[1], type: "config", line: lineOf(c, m.index), content: m[1] })
  return r
}

// SQL
export function sqlParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const ct = /CREATE\s+(?:TEMPORARY\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)/gi
  while ((m = ct.exec(c)) !== null)
    r.push({ id: `${f}:tbl:${m[2]}`, file: f, name: m[2], type: "table", line: lineOf(c, m.index), content: m[0].trim() })
  const sf = /\bFROM\s+(\w+)/gi
  while ((m = sf.exec(c)) !== null)
    r.push({ id: `${f}:tbl:${m[1]}`, file: f, name: m[1], type: "table", line: lineOf(c, m.index), content: m[0].trim() })
  return r
}

// Markdown
export function mdParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const h = /^(#+)\s+(.+)/gm
  while ((m = h.exec(c)) !== null)
    r.push({ id: `${f}:h:${m[2]}`, file: f, name: m[2], type: "heading", line: lineOf(c, m.index), content: m[0] })
  return r
}
