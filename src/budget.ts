// Tracks cumulative token usage per session from message.updated events.
// The plugin API exposes no token-count primitive, so we accumulate
// the tokens.input from each assistant message's usage stats.
// ponytail: no context-limit accessor; default 200k, override via env.

const DEFAULT_CONTEXT_LIMIT = parseInt(process.env.CONTEXT_MANAGER_CONTEXT_LIMIT || "200000", 10)

interface SessionUsage { input: number; output: number; searchQueries?: number; snippetsUsed?: number; filesRead?: number }

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

export function recordSearch(sessionID: string | undefined, usedSnippet = false): void {
  if (!sessionID) return
  const cur = sessions.get(sessionID) || { input: 0, output: 0, searchQueries: 0, snippetsUsed: 0 }
  cur.searchQueries = (cur.searchQueries || 0) + 1
  if (usedSnippet) cur.snippetsUsed = (cur.snippetsUsed || 0) + 1
  sessions.set(sessionID, cur)
}

export function recordFileRead(sessionID: string | undefined): void {
  if (!sessionID) return
  const cur = sessions.get(sessionID) || { input: 0, output: 0, filesRead: 0 }
  cur.filesRead = (cur.filesRead || 0) + 1
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

// Very rough estimate based on the README benchmark:
// search-first saves ~1732 tokens per query vs naive grep+read.
export function estimateSavings(usage: SessionUsage): number {
  const searches = usage.searchQueries || 0
  const snippets = usage.snippetsUsed || 0
  const reads = usage.filesRead || 0
  // Each search-first answer saves ~1700 tokens over a full-file read.
  const searchSavings = snippets * 1700
  // Each search that still required a read still avoided the initial glob/grep sweep (~600 tokens).
  const readSavings = (reads) * 600
  // Unmaterialized: searches that did not lead to a read are counted as full savings.
  const fullSearches = Math.max(0, searches - reads - snippets)
  return searchSavings + readSavings + fullSearches * 1700
}
