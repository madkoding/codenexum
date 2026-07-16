import { getProjectDbPath, getRegistryPath } from "./db-paths.js"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "crypto"
import type { ProjectRow } from "@codenexum/sql"

export function ensureProject(projectDir: string): string {
  const dbPath = getProjectDbPath(projectDir)
  const reg = new DatabaseSync(getRegistryPath())
  reg.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT,
    dbPath TEXT, lastSeen TEXT, chunks INTEGER DEFAULT 0, files INTEGER DEFAULT 0
  )`)
  try {
    reg.exec("ALTER TABLE projects ADD COLUMN chunks INTEGER DEFAULT 0")
  } catch {}
  try {
    reg.exec("ALTER TABLE projects ADD COLUMN files INTEGER DEFAULT 0")
  } catch {}
  const existing = reg.prepare("SELECT id FROM projects WHERE path = ?").get(projectDir) as { id: string } | undefined
  if (!existing) {
    const id = createHash("sha1").update(projectDir).digest("hex").slice(0, 16)
    const name = projectDir.split("/").pop() || projectDir
    reg.prepare("INSERT INTO projects (id, path, name, dbPath, lastSeen, chunks, files) VALUES (?, ?, ?, ?, ?, 0, 0)").run(id, projectDir, name, dbPath, new Date().toISOString())
  } else {
    reg.prepare("UPDATE projects SET lastSeen = ? WHERE path = ?").run(new Date().toISOString(), projectDir)
  }
  reg.close()
  return dbPath
}

export function updateProjectStats(projectDir: string, chunks: number, files: number): void {
  const reg = new DatabaseSync(getRegistryPath())
  reg.prepare("UPDATE projects SET chunks = ?, files = ? WHERE path = ?").run(chunks, files, projectDir)
  reg.close()
}


