import { existsSync, readdirSync, statSync, realpathSync } from "fs"
import { join, basename, dirname, resolve } from "path"
import { ensureProject, updateProjectStats } from "./auto-register.js"
import { getDb } from "./db-pool.js"
import { initSchema, dbSetSchemaVersion, SCHEMA_VERSION, dbInsertChunks, dbInsertEdges, dbSetFileHash, dbSetMeta } from "@codenexum/sql"
import { indexProject } from "./indexer.js"
import { startWatching } from "./indexer.js"
import { sseBroadcast } from "./sse.js"
import { createLogger } from "./logger.js"

const log = createLogger("discover")

const PROJECT_MARKERS = [
  ".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
  "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json",
  "mix.exs", "deno.json", "bun.lockb", "pnpm-lock.yaml",
]

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", ".cache", ".venv",
  "venv", "vendor", "__pycache__", ".next", ".opencode", ".config",
  ".idea", ".vscode", ".gradle", ".tox", "Pods",
])

const MAX_DISCOVER = 50

function isProject(dir: string): boolean {
  for (const m of PROJECT_MARKERS) {
    if (existsSync(join(dir, m))) return true
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.endsWith(".xcodeproj") || e.name.endsWith(".xcworkspace")) return true
  }
  return false
}

function safeRealpath(p: string): string {
  try { return realpathSync(p) } catch { return resolve(p) }
}

export function discoverSiblings(anchorDir: string): string[] {
  if (!anchorDir) return []
  const abs = resolve(anchorDir)
  if (!existsSync(abs)) return []
  const parent = dirname(abs)
  if (!existsSync(parent)) return []

  const realParent = safeRealpath(parent)
  const realSelf = safeRealpath(abs)
  const found = new Set<string>()

  let entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[]
  try { entries = readdirSync(realParent, { withFileTypes: true }) as any } catch { return [] }

  for (const e of entries) {
    if (found.size >= MAX_DISCOVER) break
    if (!e.isDirectory() || e.isSymbolicLink()) continue
    if (e.name === "." || e.name === "..") continue
    if (SKIP_DIRS.has(e.name)) continue
    if (e.name.startsWith(".")) continue
    const full = join(realParent, e.name)
    if (full === realSelf) continue
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    if (isProject(full)) found.add(full)
  }

  return Array.from(found)
}

export function discoverProjects(): string[] {
  return []
}

export async function autoDiscoverAndIndex(): Promise<{ discovered: number; indexed: number; errors: number }> {
  return { discovered: 0, indexed: 0, errors: 0 }
}

export async function discoverAndIndex(anchorDir: string): Promise<{ anchor: string; discovered: number; indexed: number; errors: number; projects: string[] }> {
  const paths = discoverSiblings(anchorDir)
  if (paths.length === 0) {
    return { anchor: anchorDir, discovered: 0, indexed: 0, errors: 0, projects: [] }
  }

  log.info("discover: found siblings", { count: paths.length, anchor: basename(anchorDir) })
  let indexed = 0, errors = 0
  for (const projectPath of paths) {
    try {
      const dbPath = ensureProject(projectPath)
      const db = getDb(dbPath)
      initSchema(db)
      const r = indexProject(projectPath)
      for (const fp of Object.keys(r.fileHashes)) dbSetFileHash(db, fp, r.fileHashes[fp])
      if (r.chunks.length) dbInsertChunks(db, r.chunks)
      if (r.edges.length) dbInsertEdges(db, r.edges)
      dbSetMeta(db, "lastIndexed", new Date().toISOString())
      dbSetMeta(db, "projectRoot", projectPath)
      dbSetSchemaVersion(db, SCHEMA_VERSION)
      updateProjectStats(projectPath, r.chunks.length, Object.keys(r.fileHashes).length)
      startWatching(projectPath, db)
      log.info("discover: indexed", { project: basename(projectPath), chunks: r.chunks.length, files: r.files })
      sseBroadcast("project", { type: "indexed", path: projectPath, chunks: r.chunks.length, files: r.files, addedChunks: r.chunks.length, addedFiles: Object.keys(r.fileHashes).length, source: "discover" })
      indexed++
    } catch (e: any) {
      log.warn("discover: failed to index", { path: projectPath, error: e.message })
      errors++
    }
  }
  return { anchor: anchorDir, discovered: paths.length, indexed, errors, projects: paths }
}
