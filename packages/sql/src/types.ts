export type ChunkType = "function" | "class" | "interface" | "type" | "enum" | "import" | "export" | "decorator" | "selector" | "component" | "config" | "table" | "heading"

export interface Chunk {
  id: string
  file: string
  name: string
  type: ChunkType
  line: number
  lineEnd: number
  content: string
  body: string
  lang: string
}

export interface ProjectRow {
  id: string
  path: string
  name: string
  dbPath: string
  lastSeen: string
  chunks: number
  files: number
}

export interface UsageEventRow {
  id: number
  event_type: string
  tokens_saved: number
  tokens_used: number
  meta: string | null
  ts: string
}

export interface ChunkRow {
  name: string
  content: string
  body: string
  file: string
  type: string
  line: number
  lineEnd: number
  lang: string
  score: number
}

export interface CountRow { c: number }
export interface SumRow { s: number; c: number }
export interface MetaRow { value: string }
export interface DbPathRow { dbPath: string }
export interface PathRow { path: string }
export interface ProjectListRow { id: string; name: string; path: string; dbPath: string }

export const IGNORE = new Set([
  "node_modules", "venv", "_venv", ".venv", ".git", "__pycache__",
  ".next", "dist", "build", "target", "bin", "obj", ".opencode",
  ".config", ".cache", ".vscode", ".idea", "vendor", "elixir_build",
])

export const CODE_EXTS = new Set([
  ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".css", ".scss", ".html", ".hbs", ".ejs",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".sql",
  ".md", ".txt",
])
