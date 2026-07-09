// Tracks cumulative token usage per session from message.updated events.
// The plugin API exposes no token-count primitive, so we accumulate
// the tokens.input from each assistant message's usage stats.
// ponytail: no context-limit accessor; default 200k, override via env.

const DEFAULT_CONTEXT_LIMIT = parseInt(process.env.CONTEXT_MANAGER_CONTEXT_LIMIT || "200000", 10)

interface SessionUsage { input: number; output: number }

const sessions = new Map<string, SessionUsage>()
let lastSessionID: string | undefined

export function recordTokens(sessionID: string | undefined, input: number, output: number): void {
  if (!sessionID) return
  if (!sessions.has(sessionID)) lastSessionID = sessionID
  const cur = sessions.get(sessionID) || { input: 0, output: 0 }
  cur.input = Math.max(cur.input, input)
  cur.output = Math.max(cur.output, output)
  sessions.set(sessionID, cur)
}

export function getUsage(sessionID: string | undefined): SessionUsage {
  return sessions.get(sessionID || "") || { input: 0, output: 0 }
}

export function getFillRatio(sessionID: string | undefined, contextLimit?: number): number {
  const limit = contextLimit || DEFAULT_CONTEXT_LIMIT
  if (limit <= 0) return 0
  const sid = sessionID || lastSessionID
  return getUsage(sid).input / limit
}

export function clearSession(sessionID: string | undefined): void {
  if (sessionID) sessions.delete(sessionID)
}