import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

function resolveUserData(): string {
  if (process.env.CODENEXUM_USER_DATA) return process.env.CODENEXUM_USER_DATA
  try {
    const { app } = require("electron")
    return app.getPath("userData")
  } catch {
    return process.cwd()
  }
}

export interface Settings {
  readInterception: boolean
  grepInterception: boolean
  autoCompress: boolean
  cache: boolean
  turnSavingsLog: boolean
  semanticCompression: boolean
  ansiStrip: boolean
  dedupeRuns: boolean
  stackTrim: boolean
  capBodyLines: boolean
  persistentCache: boolean
  closeToTray: boolean
  autoDiscover: boolean
  compressThreshold: number
  cacheTtlMs: number
  cacheMaxEntries: number
}

const DEFAULTS: Settings = {
  readInterception: true,
  grepInterception: true,
  autoCompress: true,
  cache: true,
  turnSavingsLog: true,
  semanticCompression: true,
  ansiStrip: true,
  dedupeRuns: true,
  stackTrim: true,
  capBodyLines: true,
  persistentCache: true,
  closeToTray: false,
  autoDiscover: true,
  compressThreshold: 8000,
  cacheTtlMs: 5 * 60 * 1000,
  cacheMaxEntries: 200,
}

function settingsPath(): string {
  return join(resolveUserData(), "settings.json")
}

let cache: Settings | null = null

function load(): Settings {
  if (cache) return cache
  const p = settingsPath()
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"))
      cache = { ...DEFAULTS, ...raw }
      return cache!
    } catch {
      cache = { ...DEFAULTS }
      return cache
    }
  }
  cache = { ...DEFAULTS }
  return cache
}

export function getSettings(): Settings {
  return { ...load() }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = load()
  const next = { ...current, ...patch }
  cache = next
  const dir = join(resolveUserData())
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
  return next
}
