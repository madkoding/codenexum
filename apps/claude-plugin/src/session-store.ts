import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, statSync, unlinkSync } from "fs"
import { join } from "path"

const HOME = process.env.HOME || "/tmp"
const DEFAULT_SESSION_DIR = join(HOME, ".codenexum", "session-edits")
const MAX_AGE_MS = 24 * 60 * 60 * 1000

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function sessionFile(sessionId: string, dir: string) {
  return join(dir, `${sessionId}.jsonl`)
}

// Claude Code hooks run as a fresh process per tool call — there is no
// long-lived in-memory state to track "did this session already edit path
// X" like the opencode plugin can. This persists that fact to a small
// per-session JSONL file instead, so a later Read of a just-edited file can
// skip substitution (the CodeNexum index may not have caught up yet).
export function recordEdit(sessionId: string, path: string, dir = DEFAULT_SESSION_DIR): void {
  if (!sessionId || !path) return
  try {
    ensureDir(dir)
    appendFileSync(sessionFile(sessionId, dir), JSON.stringify({ path, ts: Date.now() }) + "\n")
  } catch {
    /* best-effort — never let this break the hook */
  }
}

export function wasEditedThisSession(sessionId: string, path: string, dir = DEFAULT_SESSION_DIR): boolean {
  if (!sessionId || !path) return false
  const file = sessionFile(sessionId, dir)
  if (!existsSync(file)) return false
  try {
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean)
    return lines.some((line) => {
      try {
        return JSON.parse(line).path === path
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

export function cleanupOldSessions(dir = DEFAULT_SESSION_DIR): void {
  try {
    ensureDir(dir)
    const now = Date.now()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      try {
        if (now - statSync(full).mtimeMs > MAX_AGE_MS) unlinkSync(full)
      } catch {
        /* ignore single-file cleanup failures */
      }
    }
  } catch {
    /* ignore */
  }
}
