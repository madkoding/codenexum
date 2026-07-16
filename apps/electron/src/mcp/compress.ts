const COMPRESSIBLE_TOOLS = [
  "read", "bash", "sh", "zsh", "fish", "shell",
  "grep", "glob", "rg", "fd", "find",
  "npm", "yarn", "pnpm", "node", "npx", "tsc", "deno", "bun",
  "git", "curl", "wget", "ssh", "scp",
  "test", "jest", "vitest", "pytest", "cargo", "go", "rustc",
  "build", "make", "cmake", "docker", "kubectl",
  "related", "impact", "search",
]

const DEFAULT_MAX_LINES: Record<string, number> = {
  read: 25,
  bash: 30,
  sh: 30,
  zsh: 30,
  fish: 30,
  shell: 30,
  grep: 25,
  rg: 25,
  fd: 25,
  find: 25,
  glob: 50,
  npm: 20, yarn: 20, pnpm: 20, node: 30, npx: 30, tsc: 30, deno: 30, bun: 30,
  git: 20, curl: 20, wget: 20, ssh: 10, scp: 10,
  test: 30, jest: 30, vitest: 30, pytest: 30, cargo: 30, go: 30, rustc: 30,
  build: 20, make: 20, cmake: 20, docker: 20, kubectl: 20,
  related: 25, impact: 25, search: 20,
}

function getMaxLines(toolID: string): number {
  const v = process.env[`CODENEXUM_MAX_LINES_${toolID.toUpperCase()}`]
  if (v) {
    const n = parseInt(v, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_MAX_LINES[toolID] ?? 30
}

function charsToTokens(chars: number): number {
  return chars ? Math.max(0, Math.round(chars / 4)) : 0
}

export function isCompressible(toolID: string): boolean {
  return COMPRESSIBLE_TOOLS.includes(toolID)
}

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, "")
}

function dedupeRuns(lines: string[]): { lines: string[]; deduped: number } {
  if (lines.length < 5) return { lines, deduped: 0 }
  const result: string[] = []
  let deduped = 0
  let i = 0
  while (i < lines.length) {
    const cur = lines[i]
    let j = i + 1
    while (j < lines.length && lines[j] === cur) j++
    const runLen = j - i
    if (runLen >= 3) {
      result.push(`${cur} (x${runLen})`)
      deduped += runLen - 1
    } else {
      for (let k = i; k < j; k++) result.push(lines[k])
    }
    i = j
  }
  return { lines: result, deduped }
}

const STACK_FRAME_PATTERN = /^\s*(at\s+|\s*File\s+"|[^:]+:\d+:)/
function trimStackFrames(lines: string[]): { lines: string[]; trimmed: number } {
  let trimmed = 0
  const result = lines.map(line => {
    if (STACK_FRAME_PATTERN.test(line) && line.startsWith(" ")) {
      const newLine = line.replace(/^\s+/, "")
      if (newLine.length < line.length) {
        trimmed += line.length - newLine.length
        return newLine
      }
    }
    return line
  })
  return { lines: result, trimmed }
}

export interface CompressResult {
  output: string
  method: "none" | "ansi" | "dedupe" | "stack" | "truncate" | "semantic" | "combined"
  originalLen: number
  compressedLen: number
  tokensSaved: number
}

function applyPreprocessors(output: string, opts: { ansi: boolean; dedupe: boolean; stack: boolean }): { output: string; saved: number } {
  let current = output
  let totalSaved = 0
  if (opts.ansi) {
    const stripped = stripAnsi(current)
    if (stripped.length < current.length) {
      totalSaved += current.length - stripped.length
      current = stripped
    }
  }
  if (opts.stack) {
    const r = trimStackFrames(current.split("\n"))
    if (r.trimmed > 0) {
      totalSaved += r.trimmed
      current = r.lines.join("\n")
    }
  }
  if (opts.dedupe) {
    const r = dedupeRuns(current.split("\n"))
    if (r.deduped > 0) {
      totalSaved += current.length - r.lines.join("\n").length
      current = r.lines.join("\n")
    }
  }
  return { output: current, saved: totalSaved }
}

export function compressToolOutput(toolID: string, output: string, opts: { ansi?: boolean; dedupe?: boolean; stack?: boolean } = {}): CompressResult {
  const originalLen = output.length
  const maxLines = getMaxLines(toolID)
  const maxChars = MAX_CHARS_PER_TOOL[toolID] ?? MAX_CHARS_DEFAULT

  const { output: preprocessed, saved: preSaved } = applyPreprocessors(output, {
    ansi: opts.ansi !== false,
    dedupe: opts.dedupe !== false,
    stack: opts.stack !== false,
  })

  const lines = preprocessed.split("\n")
  if (lines.length <= maxLines && preSaved === 0 && preprocessed.length <= maxChars) {
    return { output, method: "none", originalLen, compressedLen: originalLen, tokensSaved: 0 }
  }

  let method: CompressResult["method"] = "truncate"
  if (preSaved > 0 && (lines.length > maxLines || preprocessed.length > maxChars)) method = "combined"
  else if (preSaved > 0) method = "combined"

  let kept = lines
  if (lines.length > maxLines) {
    kept = lines.slice(0, maxLines)
    const omitted = lines.length - maxLines
    kept.push(`\n[... ${omitted} lines omitted by codenexum compression]`)
  }
  let finalOut = kept.join("\n")
  if (finalOut.length > maxChars) {
    finalOut = finalOut.slice(0, maxChars) + `\n[... ${preprocessed.length - maxChars} chars omitted by codenexum compression]`
  }
  const finalLen = finalOut.length
  const saved = Math.max(0, charsToTokens(originalLen - finalLen))

  return {
    output: finalOut,
    method,
    originalLen,
    compressedLen: finalLen,
    tokensSaved: saved,
  }
}

const MAX_CHARS_DEFAULT = 50_000
const MAX_CHARS_PER_TOOL: Record<string, number> = {
  read: 12_000,
  bash: 16_000,
  grep: 12_000,
  rg: 12_000,
  test: 12_000,
}

let semanticCompressionSaved = 0

export function getSemanticCompressionSaved(): number {
  return semanticCompressionSaved
}

export function compressToolOutputSemantic(toolID: string, output: string, opts: { ansi?: boolean } = {}): CompressResult {
  const originalLen = output.length
  const cleaned = opts.ansi !== false ? stripAnsi(output) : output
  const lines = cleaned.split("\n")
  if (lines.length < 3) {
    return compressToolOutput(toolID, output, opts)
  }

  const summary = extractSemanticSummary(lines, toolID)
  if (!summary) {
    return compressToolOutput(toolID, output, opts)
  }

  const compressedLen = summary.length
  semanticCompressionSaved += originalLen - compressedLen
  const saved = charsToTokens(originalLen - compressedLen)

  return {
    output: summary,
    method: "semantic",
    originalLen,
    compressedLen,
    tokensSaved: saved,
  }
}

function extractSemanticSummary(lines: string[], toolID: string): string | undefined {
  if (toolID === "bash" || toolID === "sh" || toolID === "zsh" || toolID === "fish" || toolID === "shell") {
    return extractBashSummary(lines)
  }
  if (toolID === "grep" || toolID === "rg") {
    return extractGrepSummary(lines)
  }
  if (toolID === "glob" || toolID === "find" || toolID === "fd") {
    return extractGlobSummary(lines)
  }
  if (toolID === "test" || toolID === "jest" || toolID === "vitest" || toolID === "pytest") {
    return extractBashSummary(lines)
  }
  return undefined
}

function extractBashSummary(lines: string[]): string | undefined {
  let lastLine = lines[lines.length - 1]?.trim()
  if (!lastLine) {
    for (let i = lines.length - 2; i >= 0; i--) {
      const t = lines[i]?.trim()
      if (t) { lastLine = t; break }
    }
  }
  if (!lastLine) return undefined

  const counters: Record<string, number> = {}

  for (const line of lines) {
    const passMatch = line.match(/(\d+)\s+passed/)
    if (passMatch) counters.passed = (counters.passed || 0) + parseInt(passMatch[1], 10)
    const failMatch = line.match(/(\d+)\s+failed/)
    if (failMatch) counters.failed = (counters.failed || 0) + parseInt(failMatch[1], 10)
    const skipMatch = line.match(/(\d+)\s+skipped/)
    if (skipMatch) counters.skipped = (counters.skipped || 0) + parseInt(skipMatch[1], 10)
    const errorMatch = line.match(/(\d+)\s+error/)
    if (errorMatch) counters.error = (counters.error || 0) + parseInt(errorMatch[1], 10)
  }

  const parts: string[] = []
  if (counters.passed) parts.push(`${counters.passed} passed`)
  if (counters.failed) parts.push(`${counters.failed} failed`)
  if (counters.skipped) parts.push(`${counters.skipped} skipped`)
  if (counters.error) parts.push(`${counters.error} error`)
  if (parts.length === 0) return undefined

  const errorTypes = new Map<string, number>()
  const failRe = /(?:FAIL|✗|Error|error:|\bF\b)\s*[:\-]?\s*(.{0,150})/i
  for (const line of lines) {
    const m = line.match(failRe)
    if (m && m[1]) {
      const typeMatch = m[1].match(/^([A-Z][A-Za-z]*Error|[A-Z][a-z]*Error)/)
      const type = typeMatch ? typeMatch[1] : m[1].split(/[:\n]/)[0].trim().slice(0, 60) || "Error"
      if (type) errorTypes.set(type, (errorTypes.get(type) || 0) + 1)
    }
  }

  let out = `[semantic compress] Tests: ${parts.join(", ")}`
  if (errorTypes.size > 0) {
    const top = Array.from(errorTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    out += "\nFailure types:\n" + top.map(([t, c]) => `- ${t}: ${c}x`).join("\n")
    const totalErrors = Array.from(errorTypes.values()).reduce((a, b) => a + b, 0)
    if (errorTypes.size > 5) out += `\n... (${errorTypes.size - 5} more error types)`
  }
  return out
}

function extractGrepSummary(lines: string[]): string | undefined {
  const fileCount = new Set<string>()
  let matchCount = 0
  for (const line of lines) {
    const m = line.match(/^(.+?):/)
    if (m) fileCount.add(m[1])
    matchCount++
  }
  if (fileCount.size === 0) return undefined
  return `[semantic compress] grep: ${matchCount} matches in ${fileCount.size} files`
}

function extractGlobSummary(lines: string[]): string | undefined {
  const count = lines.filter(l => l.trim()).length
  if (count === 0) return undefined
  return `[semantic compress] ${count} files`
}
