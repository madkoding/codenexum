import { existsSync, readdirSync, statSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"
import { ensureProject, updateProjectStats } from "./auto-register.js"
import { getDb } from "./db-pool.js"
import { initSchema, dbSetSchemaVersion, SCHEMA_VERSION, dbInsertChunks, dbInsertEdges, dbSetFileHash, dbSetMeta } from "@codenexum/sql"
import { indexProject } from "./indexer.js"
import { startWatching } from "./indexer.js"

const PROJECT_MARKERS = [
  ".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
  "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json",
  "mix.exs", "deno.json", "bun.lockb", "pnpm-lock.yaml",
]

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", ".cache", ".venv",
  "venv", "vendor", "__pycache__", ".next", ".opencode", ".config",
])

const SCAN_ROOTS = ["proyectos", "Developer", "code", "src", "work", "projects"]
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

export function discoverProjects(): string[] {
  const home = homedir()
  const found = new Set<string>()

  for (const root of SCAN_ROOTS) {
    const base = join(home, root)
    if (!existsSync(base)) continue
    let entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[]
    try {
      entries = readdirSync(base, { withFileTypes: true }) as any
    } catch {
      continue
    }
    for (const e of entries) {
      if (found.size >= MAX_DISCOVER) break
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      if (SKIP_DIRS.has(e.name)) continue
      if (e.name.startsWith(".")) continue
      const full = join(base, e.name)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      if (isProject(full)) found.add(full)
    }
  }

  return Array.from(found)
}

export async function autoDiscoverAndIndex(): Promise<{ discovered: number; indexed: number; errors: number }> {
  const paths = discoverProjects()
  if (paths.length === 0) {
    console.log(`[codenexum] auto-discover: no project markers found under ~/`)
    return { discovered: 0, indexed: 0, errors: 0 }
  }

  console.log(`[codenexum] auto-discover: found ${paths.length} candidate(s):`)
  for (const p of paths) console.log(`  - ${basename(p)} (${p})`)

  let indexed = 0
  let errors = 0
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
      console.log(`[codenexum] auto-discover: indexed ${basename(projectPath)} (${r.chunks.length} chunks, ${r.files} files)`)
      indexed++
    } catch (e: any) {
      console.warn(`[codenexum] auto-discover: failed to index ${projectPath}: ${e.message}`)
      errors++
    }
  }

  return { discovered: paths.length, indexed, errors }
}
