import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import { createHash } from "crypto"

export function getUserDataDir(): string {
  const dir = join(app.getPath("userData"), "projects")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getRegistryPath(): string {
  return join(app.getPath("userData"), "registry.sqlite")
}

export function getProjectDbPath(projectPath: string): string {
  const hash = createHash("sha1").update(projectPath).digest("hex").slice(0, 16)
  return join(getUserDataDir(), `${hash}.sqlite`)
}
