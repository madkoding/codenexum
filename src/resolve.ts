import { isAbsolute, join, extname } from "path"
import { existsSync } from "fs"

export function parseSymbolRef(input: string, projectRoot: string): { file: string; name: string } | null {
  input = input.trim()
  if (!input) return null

  // Format: "path/to/file.ts:symbolName"
  if (input.includes(":")) {
    const lastColon = input.lastIndexOf(":")
    const filePart = input.slice(0, lastColon)
    const name = input.slice(lastColon + 1)
    if (!filePart || !name) return null
    let file = filePart
    if (!isAbsolute(file) && projectRoot) {
      file = join(projectRoot, file)
    }
    if (existsSync(file)) return { file, name }
    // If file doesn't exist, treat the whole thing as name and fall through
  }

  return null
}

export function resolvePossibleFile(projectRoot: string, name: string): string | null {
  const exts = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".c", ".cpp", ".cs"]
  for (const ext of exts) {
    const candidate = join(projectRoot, name + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}
