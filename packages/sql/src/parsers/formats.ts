import type { Chunk } from "../types"
import { makeChunk, getLang, createLineResolver } from "./common"

export function cssParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const { lineOf } = createLineResolver(c)
  const sel = /(?:^|\n)\s*(\.-?[_a-zA-Z][\w-]*|#-?[_a-zA-Z][\w-]*)/g
  while ((m = sel.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:sel:${m[1]}`, file: f, name: m[1], type: "selector", line: lineOf(m.index), content: m[1] }, f))
  const at = /(?:^|\n)\s*(@\w+)/g
  while ((m = at.exec(c)) !== null) {
    if (m[1] !== "@import") r.push(makeChunk({ id: `${f}:sel:${m[1]}`, file: f, name: m[1], type: "selector", line: lineOf(m.index), content: m[0].trim() }, f))
  }
  const prop = /(?:^|\n)\s*(--[\w-]+)\s*:/g
  while ((m = prop.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:sel:${m[1]}`, file: f, name: m[1], type: "selector", line: lineOf(m.index), content: m[1] }, f))
  return r
}

export function htmlParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const { lineOf } = createLineResolver(c)
  const comp = /<([A-Z]\w*)[\s>]/g
  while ((m = comp.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:cmp:${m[1]}`, file: f, name: m[1], type: "component", line: lineOf(m.index), content: m[0].trim() }, f))
  const id = /\s(id|data-testid)=["']([^"']+)["']/g
  while ((m = id.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:cmp:${m[2]}`, file: f, name: m[2], type: "component", line: lineOf(m.index), content: m[0].trim() }, f))
  return r
}

export function dataParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const { lineOf } = createLineResolver(c)
  const jk = /(?:^|\n)\s*"(\w+)"\s*:/g
  while ((m = jk.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:cfg:${m[1]}`, file: f, name: m[1], type: "config", line: lineOf(m.index), content: m[1] }, f))
  const yk = /(?:^|\n)(?:-\s+)?(\w[\w_-]*)\s*:(?:\s|\||>|$)/gm
  while ((m = yk.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:cfg:${m[1]}`, file: f, name: m[1], type: "config", line: lineOf(m.index), content: m[1] }, f))
  const ts = /(?:^|\n)\[(\w+(?:\.\w+)*)\]/g
  while ((m = ts.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:cfg:${m[1]}`, file: f, name: m[1], type: "config", line: lineOf(m.index), content: m[1] }, f))
  return r
}

export function sqlParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const { lineOf } = createLineResolver(c)
  const ct = /CREATE\s+(?:TEMPORARY\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)/gi
  while ((m = ct.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:tbl:${m[2]}`, file: f, name: m[2], type: "table", line: lineOf(m.index), content: m[0].trim() }, f))
  const sf = /\bFROM\s+(\w+)/gi
  while ((m = sf.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:tbl:${m[1]}`, file: f, name: m[1], type: "table", line: lineOf(m.index), content: m[0].trim() }, f))
  return r
}

export function mdParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray | null
  const { lineOf } = createLineResolver(c)
  const h = /^(#+)\s+(.+)/gm
  while ((m = h.exec(c)) !== null)
    r.push(makeChunk({ id: `${f}:h:${m[2]}`, file: f, name: m[2], type: "heading", line: lineOf(m.index), content: m[0] }, f))
  return r
}
