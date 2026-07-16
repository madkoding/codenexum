import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import { createHash } from "crypto"

function resolveUserData(): string {
  if (process.env.CODENEXUM_USER_DATA) return process.env.CODENEXUM_USER_DATA
  try { return app.getPath("userData") } catch { return process.cwd() }
}

export function getUserDataDir(): string {
  const dir = join(resolveUserData(), "projects")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getRegistryPath(): string {
  return join(resolveUserData(), "registry.sqlite")
}

export function getProjectDbPath(projectPath: string): string {
  const hash = createHash("sha1").update(projectPath).digest("hex").slice(0, 16)
  return join(getUserDataDir(), `${hash}.sqlite`)
}
