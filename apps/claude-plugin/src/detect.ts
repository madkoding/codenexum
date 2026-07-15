import { join } from "path"
import { isDenylistedPath } from "./denylist.js"

const HOME = process.env.HOME || "/tmp"

// Reduced from CodeNexum's original COMPRESSIBLE_TOOL_IDS (apps/plugin):
// curl/wget/ssh/scp are intentionally NOT ported. Their stdout is the most
// likely of the set to contain live credentials, and compressing it adds
// little indexing value compared to source/test/build output.
const COMPRESSIBLE_BASH_IDS = new Set([
  "git", "npm", "yarn", "pnpm", "node", "npx", "tsc",
  "test", "jest", "vitest", "pytest", "cargo",
  "build", "make", "cmake",
])

// "search" (Grep/Glob compression) was dropped after live validation against
// a real Claude Code session: Grep/Glob's native tool_response is a
// structured `{ filenames, numFiles, totalFiles }` object, not a free-text
// blob. CodeNexum's cm_search_snippet returns a formatted text index
// ("// index search: ...\nfile\n  symbol @ line"), which has no faithful
// mapping onto that shape — Claude Code validates that a PostToolUse hook's
// updatedToolOutput matches the original tool's output shape, so attempting
// this substitution is guaranteed to be rejected (confirmed via
// `claude -d hooks`: "expected object, received string" — same root cause
// Read had before this fix). Read and Bash are kept because their shapes
// are reconstructable: Read is `{ type, file: { content, ... } }` and Bash
// is `{ stdout, stderr, ... }` — both have one field we can swap.
export type CandidateKind = "read" | "compress"

export interface Candidate {
  kind: CandidateKind
  path?: string
  toolID?: string
}

export function detectCandidate(
  toolName: string,
  toolInput: Record<string, any>,
  cwd: string,
): Candidate | null {
  if (!cwd) return null

  if (toolName === "Read") {
    const filePath = toolInput?.file_path
    if (!filePath || isDenylistedPath(filePath)) return null
    return { kind: "read", path: filePath }
  }

  if (toolName === "Bash") {
    const cmd = (toolInput?.command || "").trim()

    const readMatch = cmd.match(/^(cat|head|tail)\s+(\S+)/)
    if (readMatch) {
      const rawPath = readMatch[2].replace(/^~/, HOME)
      const absPath = rawPath.startsWith("/") ? rawPath : join(cwd, rawPath)
      if (isDenylistedPath(absPath)) return null
      return { kind: "read", path: absPath }
    }

    const firstToken = cmd.split(/\s+/)[0]
    if (firstToken && COMPRESSIBLE_BASH_IDS.has(firstToken)) {
      return { kind: "compress", toolID: firstToken }
    }
    return null
  }

  return null
}
