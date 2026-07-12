// Tools whose output we compress. Shells and file/search tools produce
// the longest outputs and benefit most from truncation.
const COMPRESSIBLE_TOOLS = [
  "read", "bash", "sh", "zsh", "fish", "shell",
  "grep", "glob", "rg", "fd", "find",
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
}

function getMaxLines(toolID: string): number {
  const envKey = `CONTEXT_MANAGER_TOOL_MAX_LINES_${toolID.toUpperCase()}`
  const specific = process.env[envKey]
  if (specific) {
    const n = parseInt(specific, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  const general = process.env.CONTEXT_MANAGER_TOOL_MAX_LINES
  if (general) {
    const n = parseInt(general, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_MAX_LINES[toolID] ?? 50
}

function semanticCompress(output: string, toolID: string, cmd?: string): string | undefined {
  if (process.env.CONTEXT_MANAGER_SEMANTIC_COMPRESS === "0") return undefined

  // Only apply semantic compression to bash outputs from known test/lint/build runners.
  if (toolID !== "bash") return undefined
  if (!cmd) return undefined
  const RUNNER_RE = /(?:^|\s)((?:npm|npx|bun|pnpm|yarn|deno)\s+(?:run\s+)?(?:test|lint|check|typecheck|type-check|format|fmt|build|ci|audit|fix|eslint|vitest|jest|mocha|ava|tap|tape|pytest|ruff|flake8|black|mypy|pyright|prettier|biome|oxlint|rome|tsc)|(?:^|\s)(?:jest|vitest|mocha|ava|tap|tape|pytest|unittest|rspec|minitest|rubocop|eslint|tsc|cargo|go|ruff|flake8|black|mypy|pyright|prettier|biome|oxlint|rome)(?:\s|$))/i
  if (!RUNNER_RE.test(cmd)) return undefined

  const lines = output.split("\n")
  const firstLines = lines.slice(0, 10).join("\n")

  // Linters / TypeScript compiler / ESLint — detect file:row:col lines first
  // so e.g. "src/a.ts:12:3 error: ..." is not misread as "3 error" test results.
  if (/(error|warning|problem)s?/i.test(firstLines) || /^\s*\S+:\d+:\d+/m.test(output)) {
    const linterSummary = extractLinterSummary(lines, toolID)
    if (linterSummary) return linterSummary
  }

  // Test runners: Jest / Vitest / Mocha / Tap / pytest
  const testMatch = firstLines.match(/(\d+)\s+(passed|failed|skipped|error|success|tests?)/i)
  if (testMatch || /(Test Suites|Tests:|PASS|FAIL|✓|✗|passed|failed)/i.test(firstLines)) {
    const summary = extractTestSummary(lines)
    if (summary) return summary
  }

  // Package installers
  if (/added|installed|removed|packages?/i.test(firstLines) && /(npm|yarn|pnpm|pip|bun)/i.test(toolID + " " + firstLines)) {
    return extractInstallSummary(lines)
  }

  // Build tools / bundlers
  if (/error|warning|built|compiled|bundle|esbuild|webpack|vite|rollup/i.test(firstLines)) {
    return extractBuildSummary(lines)
  }

  return undefined
}

function extractTestSummary(lines: string[]): string | undefined {
  const counters: Record<string, number> = {}
  const failures: string[] = []
  let summaryFound = false
  for (const line of lines) {
    // Prefer the final summary line(s): "Tests: 4 passed, 1 failed, 5 total"
    const summary = line.match(/tests?:?\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*skipped)?(?:,\s*(\d+)\s*total)?/i)
    if (summary) {
      summaryFound = true
      counters.passed = (counters.passed || 0) + (parseInt(summary[1], 10) || 0)
      if (summary[2]) counters.failed = (counters.failed || 0) + (parseInt(summary[2], 10) || 0)
      if (summary[3]) counters.skipped = (counters.skipped || 0) + (parseInt(summary[3], 10) || 0)
      continue
    }
    // Suite summaries are secondary; only use them if no test summary exists.
    if (!summaryFound && !/suites?/i.test(line)) {
      const m = line.match(/(\d+)\s*(passed|failed|skipped|pending|todo|error)/gi)
      if (m) {
        for (const part of m) {
          const n = parseInt(part, 10)
          const key = part.replace(/\d+\s*/, "").toLowerCase()
          counters[key] = (counters[key] || 0) + (Number.isFinite(n) ? n : 0)
        }
      }
    }
    const failMatch = line.match(/(FAIL|✗|Error:)\s+(.{0,120})/i)
    if (failMatch) failures.push(failMatch[2].trim())
  }

  const parts: string[] = []
  if (counters.passed) parts.push(`${counters.passed} passed`)
  if (counters.failed) parts.push(`${counters.failed} failed`)
  if (counters.skipped) parts.push(`${counters.skipped} skipped`)
  if (counters.error) parts.push(`${counters.error} error`)
  if (parts.length === 0) return undefined

  let out = `[semantic compress] Tests: ${parts.join(", ")}`
  if (failures.length > 0) {
    out += "\nFailures:\n" + failures.slice(0, 5).map(f => `- ${f}`).join("\n")
    if (failures.length > 5) out += `\n... (${failures.length - 5} more)`
  }
  return out
}

function extractLinterSummary(lines: string[], toolID: string): string | undefined {
  const errors: string[] = []
  const warnings: string[] = []
  for (const line of lines) {
    const m = line.match(/^(\S+?):(\d+):(\d+)?\s*(error|warning|info)/i)
    if (m) {
      const [, file, row, , level] = m
      const msg = line.slice(line.indexOf(level) + level.length).trim().slice(0, 80)
      const entry = `${file}:${row}${msg ? ` - ${msg}` : ""}`
      if (level.toLowerCase() === "error") errors.push(entry)
      else warnings.push(entry)
    }
  }

  if (errors.length === 0 && warnings.length === 0) return undefined

  let out = `[semantic compress] ${toolID}: ${errors.length} error(s), ${warnings.length} warning(s)`
  if (errors.length > 0) {
    out += "\nErrors:\n" + errors.slice(0, 5).map(e => `- ${e}`).join("\n")
    if (errors.length > 5) out += `\n... (${errors.length - 5} more)`
  }
  if (warnings.length > 0) {
    out += "\nWarnings:\n" + warnings.slice(0, 5).map(w => `- ${w}`).join("\n")
    if (warnings.length > 5) out += `\n... (${warnings.length - 5} more)`
  }
  return out
}

function extractInstallSummary(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = line.match(/(added|removed|updated)\s+(\d+).*packages?/i)
    if (m) return `[semantic compress] Install: ${m[1]} ${m[2]} package(s)`
  }
  return undefined
}

function extractBuildSummary(lines: string[]): string | undefined {
  const errors: string[] = []
  let built = ""
  for (const line of lines) {
    const em = line.match(/error\s*:?\s*(.{0,100})/i)
    if (em) errors.push(em[1].trim())
    const bm = line.match(/(built|compiled|bundled)\s+(.{0,80})/i)
    if (bm) built = bm[0]
  }

  if (errors.length === 0 && !built) return undefined

  let out = `[semantic compress] Build: ${built || "incomplete"}`
  if (errors.length > 0) {
    out += "\nErrors:\n" + errors.slice(0, 5).map(e => `- ${e}`).join("\n")
    if (errors.length > 5) out += `\n... (${errors.length - 5} more)`
  }
  return out
}

export function compressToolOutput(toolID: string, output: string, cmd?: string): string {
  if (!output) return output
  if (!isCompressible(toolID)) return output

  const semantic = semanticCompress(output, toolID, cmd)
  if (semantic) return semantic

  const lines = output.split("\n")
  const max = getMaxLines(toolID)
  if (lines.length <= max) return output
  const kept = lines.slice(0, max)
  const dropped = lines.length - max
  return kept.join("\n") + `\n… (${dropped} more lines omitted; rerun with narrower args if needed)`
}

export function isCompressible(toolID: string): boolean {
  return COMPRESSIBLE_TOOLS.includes(toolID)
}

export function getSemanticCompressionSaved(original: string, compressed: string): number {
  return original.length - compressed.length
}
