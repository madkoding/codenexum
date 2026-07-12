// Types matching the plugin's WebSocket/HTTP API responses

export interface ProjectSummary {
  id: string
  name: string
  path: string
  chunks: number
  lastSeen: string
  createdAt: string
  searches: number
  filesRead: number
  toolsIntercepted: number
  compressionSaved: number
  measuredSavings: number
  efficiency: number
}

export interface SavingsByMechanism {
  indexSubstitution: number
  semanticCompression: number
  compression: number
  searchSnippets: number
  generativeCompression: number
  outputCompression: number
}

export interface AggregateData {
  totalSearches: number
  totalReads: number
  totalIntercepts: number
  totalCompressionSaved: number
  totalSearchSaved: number
  totalIndexSavedTokens: number
  totalSemanticSaved: number
  totalCacheHits: number
  totalCompactions: number
  totalGenerativeSaved: number
  totalOutputCompressionSaved: number
  totalMeasuredTokens: number
  globalEfficiency: number
  timeline: TimelineBucket[]
  toolDistribution: { tool: string; count: number }[]
  perProject: {
    id: string
    name: string
    searches: number
    reads: number
    indexSubstitutions: number
    indexSavedTokens: number
    semanticSaved: number
    cacheHits: number
    generativeSaved: number
    outputCompressionSaved: number
    efficiency: number
    measuredSavings: number
    savingsByMechanism: SavingsByMechanism
  }[]
  savingsByMechanismGlobal: SavingsByMechanism
}

export interface TimelineBucket {
  ts: number
  searches: number
  reads: number
  intercepts: number
  indexSubstitutions: number
  indexSavedTokens: number
  semanticSaved: number
  cacheHits: number
  compactions: number
  tokensSaved: number
}

export interface ToolMiss {
  tool: string
  misses: number
  total: number
  rate: number
  potentialTokens: number
}

export interface TopMissedRead {
  file: string
  misses: number
  potentialTokens: number
}

export interface ProjectStats {
  status: string
  chunks: number
  files: number
  edges: number
  languages: { ext: string; n: number }[]
  projectRoot: string
  indexedAt: string | null
  searches: number
  nativeSearches: number
  snippetOnly: number
  filesRead: number
  compactions: number
  toolsIntercepted: number
  compressionSaved: number
  semanticCompressionSaved: number
  searchSaved: number
  indexSubstitutions: number
  indexMissed: number
  indexSavedTokens: number
  cacheHits: number
  generativeCompressionSaved: number
  outputCompressionSaved: number
  measuredSavings: number
  efficiencyRatio: number
  missRate: number
  avgTokensSavedPerSearch: number
  contextFill: number
  savingsByMechanism: SavingsByMechanism
  missesByTool: ToolMiss[]
  topMissedReads: TopMissedRead[]
  recommendations: string[]
  hotFiles: { file: string; n: number }[]
  topFiles: { file: string; n: number }[]
  recentSearches: { query: string; usedSnippet: boolean; ts: number }[]
  recentEvents: { file: string; ts: number; action: string }[]
}

export interface SearchResult {
  name: string
  type: string
  file: string
  line: number
  lineEnd: number
}

export type WsMessage =
  | { type: "subscribe"; channel: string; projectId?: string }
  | { type: "unsubscribe"; channel: string }
  | { type: "search"; projectId: string; query: string; n?: number }

export type WsResponse =
  | { type: "projects"; data: ProjectSummary[] }
  | { type: "aggregate"; data: AggregateData }
  | { type: "project:stats"; data: ProjectStats }
  | { type: "search:results"; data: SearchResult[] }
