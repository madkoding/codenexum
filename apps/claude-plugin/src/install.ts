import { createHash } from "node:crypto"
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs"
import { join, basename } from "node:path"

export const MATCHER = "Read|Grep|Glob|Bash|Write|Edit"
export const BACKUP_PREFIX = ".bak."

export interface InstallPaths {
  hookSrc: string
  hookInstallDir: string
  hookInstallPath: string
  hookCommand: string
  projectDir: string
  claudeDir: string
  settingsPath: string
}

export interface InstallResult {
  hookCopied: boolean
  settingsWritten: boolean
  backupCreated: boolean | "skipped"
  hooksAlreadyPresent: boolean
}

export function sha1(buf: Buffer | string): string {
  return createHash("sha1").update(buf).digest("hex")
}

export function readFileOrNull(path: string): Buffer | null {
  try { return readFileSync(path) } catch { return null }
}

export function readJsonOrNull(path: string): unknown | null {
  const buf = readFileOrNull(path)
  if (!buf) return null
  try { return JSON.parse(buf.toString("utf-8")) } catch { return null }
}

export function buildSettings(base: any, hookCommand: string): any {
  const next: any = (base && typeof base === "object" && !Array.isArray(base))
    ? structuredClone(base)
    : {}
  next.hooks ||= {}
  next.hooks.SessionStart ||= []
  if (!hasOurCommand(next.hooks.SessionStart, hookCommand)) {
    next.hooks.SessionStart.push({ hooks: [{ type: "command", command: hookCommand }] })
  }
  next.hooks.PostToolUse ||= []
  if (!hasOurCommand(next.hooks.PostToolUse, hookCommand)) {
    next.hooks.PostToolUse.push({ matcher: MATCHER, hooks: [{ type: "command", command: hookCommand }] })
  }
  return next
}

export function hasOurCommand(entries: any[], hookCommand: string): boolean {
  if (!Array.isArray(entries)) return false
  for (const group of entries) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : []
    for (const h of hooks) {
      if (h && typeof h === "object" && h.command === hookCommand) return true
    }
  }
  return false
}

export function cleanOldBackups(settingsPath: string): number {
  const dir = join(settingsPath, "..")
  if (!existsSync(dir)) return 0
  const prefix = basename(settingsPath) + BACKUP_PREFIX
  let removed = 0
  for (const f of readdirSync(dir)) {
    if (f.startsWith(prefix)) {
      try { unlinkSync(join(dir, f)); removed++ } catch { /* ignore */ }
    }
  }
  return removed
}

export function settingsEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface InstallDeps {
  existsSync: typeof existsSync
  readFileSync: typeof readFileSync
  writeFileSync: typeof writeFileSync
  copyFileSync: typeof copyFileSync
  chmodSync: typeof chmodSync
  mkdirSync: typeof mkdirSync
  readdirSync: typeof readdirSync
  unlinkSync: typeof unlinkSync
}

const defaultDeps: InstallDeps = {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
}

export function installHook(paths: InstallPaths, options: { force?: boolean } = {}, deps: Partial<InstallDeps> = {}): InstallResult {
  const d = { ...defaultDeps, ...deps }
  if (!d.existsSync(paths.hookSrc)) {
    throw new Error(`built hook not found at ${paths.hookSrc}`)
  }
  if (!d.existsSync(paths.projectDir)) {
    throw new Error(`project path does not exist: ${paths.projectDir}`)
  }

  const srcBuf = d.readFileSync(paths.hookSrc)
  const srcHash = sha1(srcBuf)
  const installedBuf = readFileOrNull(paths.hookInstallPath)
  const installedHash = installedBuf ? sha1(installedBuf) : null
  const sameHook = srcHash === installedHash

  d.mkdirSync(paths.hookInstallDir, { recursive: true })
  let hookCopied = false
  if (!sameHook || options.force === true) {
    d.copyFileSync(paths.hookSrc, paths.hookInstallPath)
    d.chmodSync(paths.hookInstallPath, 0o755)
    hookCopied = true
  }

  d.mkdirSync(paths.claudeDir, { recursive: true })

  const current = readJsonOrNull(paths.settingsPath) ?? {}
  const next = buildSettings(current, paths.hookCommand)
  const sameSettings = settingsEqual(current, next)

  let settingsWritten = false
  let backupCreated: InstallResult["backupCreated"] = "skipped"
  if (!sameSettings || options.force === true) {
    const removed = cleanOldBackups(paths.settingsPath)
    if (d.existsSync(paths.settingsPath) && removed >= 0) {
      const backupPath = `${paths.settingsPath}${BACKUP_PREFIX}${Date.now()}`
      d.copyFileSync(paths.settingsPath, backupPath)
      backupCreated = true
    }
    d.writeFileSync(paths.settingsPath, JSON.stringify(next, null, 2) + "\n")
    settingsWritten = true
  }

  return {
    hookCopied,
    settingsWritten,
    backupCreated,
    hooksAlreadyPresent: sameHook && sameSettings,
  }
}
