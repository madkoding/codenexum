import { mkdirSync, appendFileSync } from "fs"
import { dirname, join } from "path"

const HOME = process.env.HOME || "/tmp"
const DEFAULT_AUDIT_LOG_PATH = join(HOME, ".codenexum", "audit.log")

export interface AuditEntry {
  ts: string
  sessionId?: string
  toolName: string
  path?: string
  originalChars: number
  substituteChars: number
}

// The model now sees CodeNexum's substitute text instead of the raw
// filesystem/command output for this call — this audit trail is what makes
// that substitution inspectable after the fact instead of silently trusted.
export function logSubstitution(entry: AuditEntry, path = DEFAULT_AUDIT_LOG_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(entry) + "\n")
  } catch {
    /* best-effort — never let logging break the hook */
  }
}
