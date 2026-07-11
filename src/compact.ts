// History compaction via experimental.chat.messages.transform.
// When context fill exceeds a threshold, old tool outputs are replaced
// with one-line summaries so the LLM keeps the structure but not the bulk.
// ponytail: no token primitive; we use char count as a proxy. Upgrade path:
// integrate a real tokenizer when one is available in the plugin API.

const FILL_THRESHOLD = parseFloat(process.env.CONTEXT_MANAGER_COMPACT_AT || "0.7")
const OUTPUT_MIN_CHARS = parseInt(process.env.CONTEXT_MANAGER_COMPACT_MIN_CHARS || "600", 10)
const KEEP_RECENT_TURNS = parseInt(process.env.CONTEXT_MANAGER_COMPACT_KEEP || "2", 10)

interface ToolState { status: string; output?: string; title?: string; input?: Record<string, unknown>; time?: { compacted?: number } }
interface ToolPart { type: string; tool?: string; state?: ToolState }
interface AnyPart { type: string; text?: string; tool?: string; state?: ToolState }
interface MsgEntry { info: { role?: string; sessionID?: string }; parts: AnyPart[] }

let compactionCount = 0

export function getCompactionCount(): number {
  return compactionCount
}

export function compactMessages(messages: MsgEntry[], fillRatio: number): number {
  if (fillRatio < FILL_THRESHOLD) return 0
  let compacted = 0
  const total = messages.length
  const seenOutputs = new Set<string>()

  for (let i = 0; i < total - KEEP_RECENT_TURNS; i++) {
    for (const part of messages[i].parts) {
      if (part.type !== "tool") continue
      const st = part.state
      if (!st || st.status !== "completed" || !st.output) continue
      if (st.time?.compacted) continue
      if (st.output.length < OUTPUT_MIN_CHARS) continue

      const toolName = (part as ToolPart).tool || "tool"
      const hint = summarizeInput(toolName, (st as ToolState).input)

      // Deduplicate identical outputs (common with repeated grep/read cycles).
      const fingerprint = `${toolName}:${st.output.slice(0, 200)}`
      if (seenOutputs.has(fingerprint)) {
        st.output = `[${toolName}${hint}] → (duplicate output omitted; see earlier result)`
        st.time = st.time || {}
        st.time.compacted = Date.now()
        compacted++
        continue
      }
      seenOutputs.add(fingerprint)

      const newOut = `[${toolName}${hint}] → (output omitted: ${st.output.length} chars; rerun if needed)`
      st.output = newOut
      st.time = st.time || {}
      st.time.compacted = Date.now()
      compacted++
    }
  }
  compactionCount += compacted
  return compacted
}

function summarizeInput(tool: string, input?: Record<string, unknown>): string {
  if (!input) return ""
  if (input.filePath || input.path) return ` ${input.filePath || input.path}`
  if (input.command) return ` ${String(input.command).slice(0, 40)}`
  if (input.pattern) return ` ${input.pattern}`
  if (input.query) return ` "${input.query}"`
  return ""
}
