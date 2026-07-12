// Token usage tracking per project, persisted in the registry SQLite DB.
// Savings are measured in chars and converted to tokens.  When the real text
// is available we use the configured tokenizer (tiktoken cl100k_base by
// default, with silent fallback to a 4 chars/token estimate).  When only a
// char count is available we keep the fast heuristic.
import { recordUsageEvent, getProjectUsage, getGlobalUsage, projectId, findProjectByPath } from "./registry"
import { charsToTokens } from "./tokens"

const DEFAULT_CONTEXT_LIMIT = parseInt(process.env.CONTEXT_MANAGER_CONTEXT_LIMIT || "200000", 10)

export interface SearchRecord { query: string; usedSnippet: boolean; ts: number }

export interface SessionUsage {
  input: number
  output: number
  searchQueries?: number
  nativeSearches?: number
  snippetsUsed?: number
  filesRead?: number
  recentSearches?: SearchRecord[]
  compactions?: number
  compressionSaved?: number
  semanticCompressionSaved?: number
  searchSaved?: number
  toolsIntercepted?: number
  indexSubstitutions?: number
  indexMissed?: number
  indexSavedTokens?: number
  cacheHits?: number
  generativeCompressionSaved?: number
  outputCompressionSaved?: number}

interface SessionState {
  projectId: string | undefined
  lastInputTokens: number
  sessionId: string | undefined
}

const sessionStates = new Map<string, SessionState>()
const MAX_SESSION_STATES = 256
let defaultState: SessionState = { projectId: undefined, lastInputTokens: 0, sessionId: undefined }

function pruneSessionStates(): void {
  while (sessionStates.size > MAX_SESSION_STATES) {
    const first = sessionStates.keys().next().value as string | undefined
    if (first) sessionStates.delete(first)
    else break
  }
}

function getState(sessionId?: string): SessionState {
  if (sessionId && sessionStates.has(sessionId)) return sessionStates.get(sessionId)!
  return defaultState
}

export function setProjectContext(directory: string, sessionId?: string): void {
  const pid = projectId(directory)
  const st: SessionState = { projectId: pid, lastInputTokens: 0, sessionId }
  if (sessionId) {
    sessionStates.set(sessionId, st)
    pruneSessionStates()
  }
  else defaultState = st
}

function resolveProjectId(filePath?: string): string | undefined {
  if (filePath) {
    const proj = findProjectByPath(filePath)
    if (proj) return proj.id
  }
  return defaultState.projectId
}

export function recordTokens(sessionID: string | undefined, input: number, output: number): void {
  const st = getState(sessionID)
  st.lastInputTokens = Math.max(st.lastInputTokens, input)
  if (sessionID) sessionStates.set(sessionID, st)
}

export function getLastInputTokens(): number {
  return defaultState.lastInputTokens
}

export function recordSearch(sessionID: string | undefined, query: string, usedSnippet = false): void {
  const pid = resolveProjectId()
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "search", query, usedSnippet ? 1 : 0)
}

export function recordSearchSavings(sessionID: string | undefined, charsSaved: number): void {
  const pid = resolveProjectId()
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "search_savings", undefined, charsToTokens(charsSaved))
}

export function recordNativeSearch(sessionID: string | undefined, query: string, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "native_search", query)
}

export function recordFileRead(sessionID: string | undefined, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "read")
}

export function recordCompaction(sessionID: string | undefined): void {
  const pid = resolveProjectId()
  if (!pid) return
  // Only count that compaction happened. We deliberately do not claim chars
  // saved because compaction changes the information the model sees.
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "compaction")
}

export function recordCompression(sessionID: string | undefined, charsSaved: number, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "compression", undefined, charsToTokens(charsSaved))
}

export function recordSemanticCompression(sessionID: string | undefined, charsSaved: number, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "semantic_compression", undefined, charsToTokens(charsSaved))
}

export function recordCacheHit(sessionID: string | undefined, toolName?: string, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "cache_hit", toolName || "tool")
}

export function recordGenerativeCompression(sessionID: string | undefined, charsSaved: number, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "generative_compression", filePath || "file", charsToTokens(charsSaved))
}

export function recordOutputCompression(sessionID: string | undefined, charsSaved: number, role?: string): void {
  const pid = resolveProjectId()
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "output_compression", role || "assistant", charsToTokens(charsSaved))
}

export function recordToolIntercept(sessionID: string | undefined, toolName?: string, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "intercept", toolName || "tool")
}

export function recordIndexSubstitution(sessionID: string | undefined, savedTokens: number, toolName?: string, filePath?: string): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "index_substitute", toolName || "tool", Math.max(0, Math.round(savedTokens)))
}

export function recordIndexMiss(sessionID: string | undefined, toolName?: string, filePath?: string, estimatedTokens?: number): void {
  const pid = resolveProjectId(filePath)
  if (!pid) return
  const query = toolName && filePath ? `${toolName}|${filePath}` : (toolName || filePath || "tool")
  recordUsageEvent(pid, sessionID || defaultState.sessionId, "index_missed", query, estimatedTokens ? Math.max(0, Math.round(estimatedTokens)) : 0)
}

export function getUsage(sessionID?: string): SessionUsage {
  const st = getState(sessionID)
  const pid = st.projectId
  if (!pid) return { input: 0, output: 0 }
  const u = getProjectUsage(pid)
  return {
    input: st.lastInputTokens,
    output: 0,
    searchQueries: u.searchQueries,
    nativeSearches: u.nativeSearches,
    snippetsUsed: u.snippetsUsed,
    filesRead: u.filesRead,
    recentSearches: u.recentSearches,
    compactions: u.compactions,
    compressionSaved: u.compressionSaved,
    semanticCompressionSaved: u.semanticCompressionSaved,
    searchSaved: u.searchSaved,
    toolsIntercepted: u.toolsIntercepted,
    indexSubstitutions: u.indexSubstitutions,
    indexMissed: u.indexMissed,
    indexSavedTokens: u.indexSavedTokens,
    cacheHits: u.cacheHits,
    generativeCompressionSaved: u.generativeCompressionSaved,
  }
}

export function getFillRatio(sessionID: string | undefined, contextLimit?: number): number {
  const limit = contextLimit || DEFAULT_CONTEXT_LIMIT
  if (limit <= 0) return 0
  const st = getState(sessionID)
  return st.lastInputTokens / limit
}

export function clearSession(sessionID: string | undefined): void {
  if (sessionID) sessionStates.delete(sessionID)
}

// Real token savings: only directly observable char/token differences.
// Both compression and search savings are now stored as estimated tokens via
// charsToTokens(), so measuredSavings can sum them directly.
// Compaction is intentionally excluded because it changes the information the
// model receives; we cannot claim it as a real token saving.
export function measuredSavings(usage: SessionUsage): number {
  return (usage.compressionSaved || 0) + (usage.semanticCompressionSaved || 0) + (usage.searchSaved || 0) + (usage.indexSavedTokens || 0) + (usage.generativeCompressionSaved || 0) + (usage.outputCompressionSaved || 0)
}

export { DEFAULT_CONTEXT_LIMIT, getGlobalUsage }