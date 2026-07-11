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

export const IGNORE = new Set([
  "node_modules", "venv", "_venv", ".venv", ".git", "__pycache__",
  ".next", "dist", "build", "target", "bin", "obj", ".opencode",
  ".config", ".cache", ".vscode", ".idea", "vendor", "elixir_build",
])

export const CODE_EXTS = new Set([
  ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".css", ".scss",
  ".html", ".hbs", ".ejs",
  ".json", ".yaml", ".yml", ".toml",
  ".sql", ".md",
])