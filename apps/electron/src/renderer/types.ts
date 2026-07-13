export interface Project {
  id: string
  path: string
  name: string
  dbPath: string
  lastSeen: string
}

export interface ProjectSummary extends Project {
  chunks: number
  files: number
  edges: number
}

export interface ProjectStats extends ProjectSummary {
  hotFiles: { path: string; count: number }[]
  topFiles: { path: string; count: number }[]
  languages: { name: string; count: number }[]
  recentSearches: any[]
  recentEvents: { type: string; tokensSaved: number; tokensUsed: number; meta: any; ts: string }[]
  savingsByMechanism: Record<string, number>
  lastIndexed: string | null
  measuredSavings: number
  searches: number
  searchQueries: number
  nativeSearches: number
  indexSubstitutions: number
  cacheHits: number
  filesRead: number
  snippetOnly: number
  compactions: number
  semanticCompressionSaved: number
  generativeCompressionSaved: number
  outputCompressionSaved: number
  efficiencyRatio: number
  indexedAt: string | null
  status: string
  missRate: number
  missesByTool: any
  recommendations: string[]
  avgTokensSavedPerSearch: number
  topMissedReads: any[]
}

export interface AggregateData {
  byType: Record<string, number>
  byLang: Record<string, number>
  topFiles: { path: string; count: number }[]
}
