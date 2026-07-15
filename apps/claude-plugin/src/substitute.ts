// Claude Code validates that a PostToolUse hook's `updatedToolOutput` matches
// the ORIGINAL tool's response shape (confirmed via `claude -d hooks`: a bare
// string gets rejected with "expected object, received string"). Read's
// response is `{ type, file: { filePath, content, numLines, startLine,
// totalLines } }`; Bash's is `{ stdout, stderr, interrupted, isImage,
// noOutputExpected }`. Both are reconstructed by cloning the original object
// and swapping only the one field CodeNexum's snippet replaces.
export function extractCompressibleText(toolName: string, toolResponse: unknown): string | null {
  if (toolName === "Read") {
    const content = (toolResponse as any)?.file?.content
    return typeof content === "string" ? content : null
  }
  if (toolName === "Bash") {
    const stdout = (toolResponse as any)?.stdout
    return typeof stdout === "string" ? stdout : null
  }
  return null
}

export function buildUpdatedResponse(toolName: string, toolResponse: unknown, compressed: string): unknown | null {
  if (toolName === "Read") {
    const file = (toolResponse as any)?.file
    if (!file || typeof file !== "object") return null
    return {
      ...(toolResponse as object),
      file: {
        ...file,
        content: compressed,
        numLines: compressed.split("\n").length,
      },
    }
  }
  if (toolName === "Bash") {
    if (typeof toolResponse !== "object" || toolResponse === null) return null
    return { ...(toolResponse as object), stdout: compressed }
  }
  return null
}

export function substituteString(original: string, replacement: string): string {
  if (replacement.length <= original.length) return replacement
  return replacement.slice(0, original.length)
}

// Matches CodeNexum's own char->token heuristic (apps/plugin/src/index.ts)
// so tokensSaved reported to cm_log_event is comparable across both clients.
export function charsToTokens(chars: number): number {
  return chars > 0 ? Math.max(0, Math.round(chars / 4)) : 0
}
