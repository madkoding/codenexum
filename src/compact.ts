// History compaction via experimental.chat.messages.transform.
// When context fill exceeds a threshold, old tool outputs are replaced
// with one-line summaries so the LLM keeps the structure but not the bulk.

const FILL_THRESHOLD = parseFloat(process.env.CONTEXT_MANAGER_COMPACT_AT || "0.6")
const OUTPUT_MIN_CHARS = parseInt(process.env.CONTEXT_MANAGER_COMPACT_MIN_CHARS || "400", 10)
const KEEP_RECENT_TURNS = parseInt(process.env.CONTEXT_MANAGER_COMPACT_KEEP || "2", 10)

interface ToolState { status: string; output?: string; title?: string; input?: Record<string, unknown>; time?: { compacted?: number } }
interface ToolPart { type: string; tool?: string; state?: ToolState }
interface AnyPart { type: string; text?: string; tool?: string; state?: ToolState }
interface MsgEntry { info: { role?: string; sessionID?: string }; parts: AnyPart[] }

let compactionCount = 0

const MAX_SESSIONS = 64

// Track which outputs have already been compacted per session to avoid
// re-processing the same fresh copies on repeated messages.transform calls.
const compactedFingerprintsBySession = new Map<string, Set<string>>()

function ensureSession(sessionID: string): Set<string> {
  let s = compactedFingerprintsBySession.get(sessionID)
  if (!s) {
    if (compactedFingerprintsBySession.size >= MAX_SESSIONS) {
      const first = compactedFingerprintsBySession.keys().next().value
      if (first) compactedFingerprintsBySession.delete(first)
    }
    s = new Set()
    compactedFingerprintsBySession.set(sessionID, s)
  }
  return s
}

export function getCompactionCount(): number {
  return compactionCount
}

export function resetCompactionState(): void {
  compactionCount = 0
  compactedFingerprintsBySession.clear()
}

export function resetCompactionSession(sessionID: string): void {
  compactedFingerprintsBySession.delete(sessionID || "_")
}

export function compactMessages(messages: MsgEntry[], fillRatio: number): { count: number } {
  try {
  if (FILL_THRESHOLD <= 0) return { count: 0 }
  if (fillRatio < FILL_THRESHOLD) return { count: 0 }
  let compacted = 0
  const total = messages.length
  const sessionID = messages[0]?.info?.sessionID || "_"
  const seenOutputs = new Set<string>()
  const newlyCompacted = new Set<string>()

  for (let i = 0; i < total - KEEP_RECENT_TURNS; i++) {
    for (const part of messages[i].parts) {
      if (part.type !== "tool") continue
      const st = part.state
      if (!st || st.status !== "completed" || !st.output) continue
      if (st.output.length < OUTPUT_MIN_CHARS) continue

      const toolName = (part as ToolPart).tool || "tool"
      const input = (st as ToolState).input
      const hint = summarizeInput(toolName, input)
      const originalLen = st.output.length

      const fingerprint = `${toolName}:${st.output.slice(0, 200)}`
      const sessionFingerprints = compactedFingerprintsBySession.get(sessionID)
      // Skip if already compacted in a previous transform for this session
      if (sessionFingerprints?.has(fingerprint)) continue
      // Handle duplicates within the same call
      if (seenOutputs.has(fingerprint)) {
        st.output = `[${toolName}${hint}] → (duplicate output omitted; see earlier result)`
        st.time = st.time || {}
        st.time.compacted = Date.now()
        newlyCompacted.add(fingerprint)
        compacted++
        continue
      }
      seenOutputs.add(fingerprint)

      const indexRef = buildIndexReference(toolName, input)
      if (indexRef) {
        st.output = `[${toolName}${hint}] → (output omitted: ${originalLen} chars; ${indexRef})`
      } else {
        st.output = `[${toolName}${hint}] → (output omitted: ${originalLen} chars; rerun if needed)`
      }
      st.time = st.time || {}
      st.time.compacted = Date.now()
      newlyCompacted.add(fingerprint)
      compacted++
    }
  }
  if (newlyCompacted.size > 0) {
    const s = ensureSession(sessionID)
    for (const f of newlyCompacted) s.add(f)
  }
  compactionCount += compacted
  return { count: compacted }
  } catch (e) {
    return { count: 0 }
  }
}

function summarizeInput(tool: string, input?: Record<string, unknown>): string {
  if (!input) return ""
  if (input.filePath || input.path) return ` ${input.filePath || input.path}`
  if (input.command) return ` ${String(input.command).slice(0, 40)}`
  if (input.pattern) return ` ${input.pattern}`
  if (input.query) return ` "${input.query}"`
  return ""
}

function buildIndexReference(tool: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined
  if (tool === "read") {
    const path = (input.filePath || input.path || input.file) as string | undefined
    if (path) return `use context_search file:${path}`
  }
  if (tool === "grep" || tool === "glob") {
    const query = (input.pattern || input.query || input.q) as string | undefined
    if (query) return `use context_search "${query}"`
  }
  if (tool === "bash") {
    const cmd = String(input.command || input.cmd || input.script || "")
    const m = /\b(cat|head|tail|less|more|bat)\b\s+['"]?([^'"\s]+)/i.exec(cmd)
    if (m && m[2]) return `use context_search file:${m[2]}`
    const gm = /\b(grep|rg|find|fd|git grep)\b\s+['"]?([^'"\s]+)/i.exec(cmd)
    if (gm && gm[2]) return `use context_search "${gm[2]}"`
  }
  return undefined
}
