import { getProjectDbPath, getRegistryPath } from "./db-paths.js"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "crypto"

export function ensureProject(projectDir: string): string {
  const dbPath = getProjectDbPath(projectDir)
  const reg = new DatabaseSync(getRegistryPath())
  reg.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT,
    dbPath TEXT, lastSeen TEXT
  )`)
  const existing = reg.prepare("SELECT id FROM projects WHERE path = ?").get(projectDir)
  if (!existing) {
    const id = createHash("sha1").update(projectDir).digest("hex").slice(0, 16)
    const name = projectDir.split("/").pop() || projectDir
    reg.prepare("INSERT INTO projects (id, path, name, dbPath, lastSeen) VALUES (?, ?, ?, ?, ?)").run(id, projectDir, name, dbPath, new Date().toISOString())
  } else {
    reg.prepare("UPDATE projects SET lastSeen = ? WHERE path = ?").run(new Date().toISOString(), projectDir)
  }
  reg.close()
  return dbPath
}


