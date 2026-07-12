import { readdirSync, readFileSync, realpathSync, existsSync, mkdirSync } from "fs"
import { join, extname } from "path"
import { createHash } from "crypto"
import type { Database } from "bun:sqlite"
import type { Chunk } from "./types"
import type { Edge } from "./edges"
import { IGNORE, CODE_EXTS } from "./types"
import { PARSERS } from "./parsers"
import { dbInsertChunks, dbDeleteFile, dbGetFileHash, dbSetFileHash, dbInsertEdges, dbDeleteEdgesForFile } from "./store"
import { extractEdges } from "./edges"

function hash(s: string): string {
  return createHash("md5").update(s).digest("hex")
}

const DEFAULT_MAX_FILES = 10000

export function getMaxFiles(): number {
  const v = process.env.CONTEXT_MANAGER_MAX_FILES
  if (!v) return DEFAULT_MAX_FILES
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FILES
}

export function walk(dir: string, seen: Set<string>, cap = Infinity): string[] {
  let files: string[] = []
  try {
    const real = realpathSync(dir)
    if (seen.has(real)) return []
    seen.add(real)
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= cap) break
      if (e.isDirectory()) {
        if (!IGNORE.has(e.name)) files.push(...walk(join(dir, e.name), seen, cap - files.length))
      } else if (e.isFile() && CODE_EXTS.has(extname(e.name))) {
        files.push(join(dir, e.name))
      }
    }
  } catch (e) {
    // skip dirs that can't be read
  }
  return files
}

export function parseFile(fp: string): Chunk[] {
  const ext = extname(fp)
  const p = PARSERS[ext]
  if (!p) return []
  return p(readFileSync(fp, "utf-8"), fp)
}

export function indexProject(root: string, maxFiles = getMaxFiles()): { files: number; chunks: Chunk[]; fileHashes: Record<string, string>; edges: Edge[]; capped: boolean } {
  const files = walk(root, new Set(), maxFiles)
  const capped = files.length >= maxFiles
  const chunks: Chunk[] = []
  const fileHashes: Record<string, string> = {}
  for (const fp of files) {
    try {
      const content = readFileSync(fp, "utf-8")
      fileHashes[fp] = hash(content)
      const ext = extname(fp)
      const p = PARSERS[ext]
      if (p) chunks.push(...p(content, fp))
    } catch {
      // skip unreadable files
    }
  }
  const edges = extractEdges(chunks)
  return { files: files.length, chunks, fileHashes, edges, capped }
}

export type LogFn = (level: string, msg: string, extra?: Record<string, unknown>) => void

export interface IndexEvent { file: string; ts: number; action: "add" | "change" | "delete" }

const recentEvents: IndexEvent[] = []
const MAX_RECENT_EVENTS = 20

export function recordIndexEvent(event: IndexEvent): void {
  recentEvents.unshift(event)
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.length = MAX_RECENT_EVENTS
}

export function getRecentIndexEvents(): IndexEvent[] {
  return recentEvents.slice()
}

export function updateFile(db: Database, fp: string, log?: LogFn): boolean {
  const ext = extname(fp)
  if (!CODE_EXTS.has(ext)) return false
  let content: string
  try { content = readFileSync(fp, "utf-8") } catch {
    log?.("warn", "failed to read file", { file: fp })
    return false
  }
  const h = hash(content)
  if (dbGetFileHash(db, fp) === h) return false
  dbDeleteFile(db, fp)
  dbDeleteEdgesForFile(db, fp)
  const newChunks = parseFile(fp)
  const newEdges = extractEdges(newChunks)
  dbInsertChunks(db, newChunks)
  dbInsertEdges(db, newEdges)
  dbSetFileHash(db, fp, h)
  recordIndexEvent({ file: fp, ts: Date.now(), action: "change" })
  log?.("debug", "reindexed file", { file: fp, chunks: newChunks.length, edges: newEdges.length })
  return true
}

const _debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export function debouncedUpdateFile(db: Database, fp: string, ms = 500, log?: LogFn): void {
  if (_debounceTimers[fp]) clearTimeout(_debounceTimers[fp])
  _debounceTimers[fp] = setTimeout(() => {
    delete _debounceTimers[fp]
    try { updateFile(db, fp, log) } catch {}
  }, ms)
}

export { hash }