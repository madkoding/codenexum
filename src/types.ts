export interface Chunk {
  id: string
  file: string
  name: string
  type: "function" | "class" | "interface" | "type" | "enum"
  line: number
  content: string
}

export const IGNORE = new Set([
  "node_modules", "venv", "_venv", ".venv", ".git", "__pycache__",
  ".next", "dist", "build", "target", "bin", "obj", ".opencode",
  ".config", ".cache", ".vscode", ".idea", "vendor", "elixir_build",
])

export const CODE_EXTS = new Set([
  ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs",
])