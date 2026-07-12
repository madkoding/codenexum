import type { Database } from "bun:sqlite"
import { isAbsolute, relative, resolve } from "path"
import { statSync, readFileSync } from "fs"
import { createHash } from "crypto"
import { dbGetChunksForFile, dbFindFilesByPattern, dbSearch, dbGetFileHash, type SearchResult } from "./store"
import { formatSearchResults } from "./format"
import { charsToTokens } from "./tokens"
import type { ConversationContext } from "./context"

export type InterceptMode = "off" | "warn" | "substitute"

export interface InterceptCandidate {
  tool: string
  originalTool: string
  args: any
  /** Absolute path resolved from the tool args, if any. */
  resolvedPath?: string
  /** Query/pattern extracted from grep/glob/bash args. */
  query?: string
  /** Reason why this call may be intercepted. */
  reason: string
  /** True if we can replace the native output with index content. */
  substitutable: boolean
}

export interface InterceptResult {
  /** Whether the index had a replacement. */
  replaced: boolean
  /** Replacement output, when replaced is true. */
  output?: string
  /** Tokens we estimate were saved by the replacement. */
  tokensSaved?: number
  /** If we did not replace, estimated tokens that *could* have been saved. */
  potentialSavings?: number
  /** Reason for the decision. */
  reason: string
}

export interface InterceptOptions {
  mode?: InterceptMode
  interceptBash?: boolean
}

const DEFAULT_OPTIONS: InterceptOptions = {
  mode: (process.env.CONTEXT_MANAGER_INTERCEPT_MODE as InterceptMode) || "substitute",
  interceptBash: process.env.CONTEXT_MANAGER_INTERCEPT_BASH !== "0",
}

const COMPLEX_BASH_RE = /[|&;\n`$(){}[\]<>!]|<<|\>\>|\$\(|` | \)|\{|\}|&&|\|\||;/

const READ_COMMANDS = new Set(["cat", "head", "tail", "less", "more", "bat"])
const SEARCH_COMMANDS = new Set(["grep", "rg", "fd"])
const MUTATING_COMMANDS = new Set(["commit", "push", "reset", "checkout", "merge", "rebase", "add", "rm", "mv", "branch", "tag", "stash", "cherry-pick", "revert"])

function resolveProjectPath(projectRoot: string, filePath: string): string | undefined {
  if (!filePath) return undefined
  let absolute = filePath
  if (!isAbsolute(filePath)) {
    absolute = resolve(projectRoot, filePath)
  }
  // Only handle paths inside the project root.
  if (!absolute.startsWith(projectRoot)) return undefined
  try {
    statSync(absolute)
    return absolute
  } catch {
    // File may not exist on disk but might still be indexed (e.g. deleted
    // recently). Accept it if it is absolute and inside project root.
    return absolute
  }
}

function relativeForDisplay(projectRoot: string, filePath: string): string {
  if (!projectRoot) return filePath
  if (!filePath.startsWith(projectRoot)) return filePath
  let rel = filePath.slice(projectRoot.length)
  if (rel.startsWith("/")) rel = rel.slice(1)
  return rel || filePath
}

export function getInterceptOptions(): InterceptOptions {
  return { ...DEFAULT_OPTIONS }
}

export function detectInterceptCandidate(
  db: Database | null,
  projectRoot: string,
  tool: string,
  args: any,
  options: InterceptOptions = DEFAULT_OPTIONS,
): InterceptCandidate | undefined {
  if (!db) return undefined
  if (dbChunkCount(db) === 0) return undefined
  if (options.mode === "off") return undefined

  const a = args || {}
  const filePath = a.filePath || a.path || a.file || ""
  const command = typeof a.command === "string" ? a.command : typeof a.cmd === "string" ? a.cmd : ""
  const pattern = a.pattern || a.query || a.q || a.glob || a.pattern || ""

  // Direct read.
  if (tool === "read" && filePath) {
    const resolved = resolveProjectPath(projectRoot, filePath)
    if (resolved) {
      return {
        tool: "read",
        originalTool: tool,
        args: a,
        resolvedPath: resolved,
        reason: "read of project file",
        substitutable: options.mode === "substitute",
      }
    }
    return undefined
  }

  // grep / glob.
  if ((tool === "grep" || tool === "glob") && pattern) {
    // grep is high-confidence text search, so only warn to avoid hiding exact-match evidence.
    return {
      tool: tool === "glob" ? "glob" : "grep",
      originalTool: tool,
      args: a,
      query: pattern,
      reason: `${tool} with pattern "${pattern}"`,
      substitutable: false,
    }
  }

  // Bash simple commands.
  if (options.interceptBash && tool === "bash" && command) {
    // Reject complex commands to avoid misinterpreting user intent.
    if (COMPLEX_BASH_RE.test(command)) return undefined
    const tokens = command.trim().split(/\s+/)
    const base = tokens[0]
    if (!base) return undefined

    // cat/head/tail file.ts
    if (READ_COMMANDS.has(base)) {
      const pathArg = findPathArg(tokens, projectRoot)
      if (pathArg) {
        return {
          tool: "bash-read",
          originalTool: tool,
          args: a,
          resolvedPath: pathArg,
          reason: `bash ${base} of project file`,
          substitutable: options.mode === "substitute",
        }
      }
    }

    // grep/rg/fd term [path]
    if (SEARCH_COMMANDS.has(base)) {
      const { query, path } = parseSearchCommand(tokens, projectRoot)
      if (query) {
        return {
          tool: "bash-grep",
          originalTool: tool,
          args: a,
          query,
          resolvedPath: path,
          reason: `bash ${base} searching "${query}"`,
          substitutable: options.mode === "substitute",
        }
      }
    }

    // git grep term [path] — only git grep, not git status/log/diff/commit etc.
    if (base === "git" && tokens.length >= 3 && tokens[1] === "grep") {
      const subTokens = ["git", ...tokens.slice(2)]
      const { query, path } = parseSearchCommand(subTokens, projectRoot)
      if (query) {
        return {
          tool: "bash-grep",
          originalTool: tool,
          args: a,
          query,
          resolvedPath: path,
          reason: `bash git grep searching "${query}"`,
          substitutable: options.mode === "substitute",
        }
      }
    }

    // Reject mutating git commands so their output is never replaced.
    if (base === "git" && tokens.length >= 2 && MUTATING_COMMANDS.has(tokens[1])) {
      return undefined
    }
  }

  return undefined
}

function findPathArg(tokens: string[], projectRoot: string): string | undefined {
  // Skip command and flags, look for an absolute or resolvable project path.
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith("-")) continue
    const resolved = resolveProjectPath(projectRoot, t)
    if (resolved) return resolved
  }
  return undefined
}

function parseSearchCommand(tokens: string[], projectRoot: string): { query?: string; path?: string } {
  // Common patterns:
  // grep -n "foo" file.ts
  // rg "foo" src/
  // git grep foo
  // find src -name "*.ts"
  // fd "foo" src
  let query: string | undefined
  let path: string | undefined
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith("-")) {
      // Skip flag and its argument for flags that take one.
      if (["-e", "-f", "-C", "-A", "-B", "-t", "-g", "-m", "--type", "--glob", "--max-count", "--context", "--after-context", "--before-context", "--file", "--regexp"].includes(t)) {
        i++
      }
      continue
    }
    if (!query) {
      query = stripQuotes(t)
    } else {
      const resolved = resolveProjectPath(projectRoot, t)
      if (resolved) path = resolved
    }
  }
  return { query, path }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function fileHash(filePath: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex")
  } catch {
    return null
  }
}

function filterChunksByOffset(
  chunks: SearchResult[],
  offset?: number,
  limit?: number,
): SearchResult[] {
  if (!offset && !limit) return chunks
  const start = Math.max(1, offset || 1)
  const end = limit ? start + limit - 1 : Number.MAX_SAFE_INTEGER
  return chunks.filter(c => c.lineEnd >= start && c.line <= end)
}

export function shouldStripComments(): boolean {
  return process.env.CONTEXT_MANAGER_INCLUDE_COMMENTS === "0"
}

function stripComments(body: string, lang: string): string {
  if (!shouldStripComments() || !body) return body
  const lines = body.split("\n")
  const out: string[] = []
  let inBlock = false
  const blockStart = lang === "py" ? '"""' : "/*"
  const blockEnd = lang === "py" ? '"""' : "*/"
  for (const line of lines) {
    let inString: string | null = null
    let escaped = false
    let code = ""
    let inLineComment = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      const next = line[i + 1]
      if (inLineComment) continue
      if (inBlock) {
        if (lang !== "py" && ch === "*" && next === "/") { inBlock = false; i++; }
        else if (lang === "py" && ch === '"' && next === '"' && line[i + 2] === '"') { inBlock = false; i += 2; }
        continue
      }
      if (escaped) { escaped = false; code += ch; continue }
      if (ch === "\\") { escaped = true; code += ch; continue }
      if (inString) {
        if (ch === inString) inString = null
        code += ch
        continue
      }
      if ((ch === '"' || ch === "'" || ch === "`") && !inBlock) {
        inString = ch
        code += ch
        continue
      }
      // Single-line comments for common languages.
      if (["py", "rb", "sh", "yml", "yaml"].includes(lang) && ch === "#") { inLineComment = true; continue }
      if (ch === "/" && next === "/") { inLineComment = true; i++; continue }
      // Block comments
      if (ch === "/" && next === "*") { inBlock = true; i++; continue }
      if (lang === "py" && ch === '"' && next === '"' && line[i + 2] === '"') { inBlock = true; i += 2; continue }
      code += ch
    }
    if (code.trim().length > 0 || line.trim().length === 0) {
      out.push(code)
    }
  }
  // If block comment wasn't closed, don't return mangled output; keep original.
  return inBlock ? body : out.join("\n")
}

function rankChunksByRelevance(chunks: SearchResult[], terms: string[]): SearchResult[] {
  if (terms.length === 0) return chunks
  const termSet = new Set(terms.map(t => t.toLowerCase()))
  const scored = chunks.map(c => {
    let score = 0
    const name = c.name.toLowerCase()
    const body = (c.body || c.content || "").toLowerCase()
    for (const term of termSet) {
      if (name.includes(term)) score += 3
      if (body.includes(term)) score += 1
    }
    return { chunk: c, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map(s => s.chunk)
}

function buildFileSubstitute(
  db: Database,
  projectRoot: string,
  filePath: string,
  nativeOutputChars: number,
  offset?: number,
  limit?: number,
  conversationContext?: ConversationContext,
): { output: string; originalChars: number; savedChars: number } | undefined {
  const chunks = dbGetChunksForFile(db, filePath)
  if (chunks.length === 0) return undefined
  let filtered = filterChunksByOffset(chunks, offset, limit)
  if (filtered.length === 0) return undefined

  if (process.env.CONTEXT_MANAGER_SMART_READ === "1" && conversationContext && !offset && !limit) {
    const terms = conversationContext.getTerms()
    if (terms.length > 0) {
      filtered = rankChunksByRelevance(filtered, terms).slice(0, 5)
    }
  }

  const rel = relativeForDisplay(projectRoot, filePath)
  const lines: string[] = [
    `// index: ${rel}${offset || limit ? ` lines ${offset || 1}${limit ? `-${(offset || 1) + limit - 1}` : ""}` : ""}`,
    "",
  ]
  for (const c of filtered) {
    const range = c.lineEnd > c.line ? `${c.line}-${c.lineEnd}` : `${c.line}`
    lines.push(`// ${c.type} ${c.name} @ ${range}`)
    const body = stripComments(c.body || c.content || "", c.lang)
    if (body) lines.push(body)
    lines.push("")
  }
  const output = lines.join("\n")

  const savedChars = nativeOutputChars - output.length
  return { output, originalChars: nativeOutputChars, savedChars }
}

function buildSearchSubstitute(
  db: Database,
  projectRoot: string,
  query: string,
  nativeOutputChars: number,
  fileFilter?: string,
): { output: string; originalChars: number; savedChars: number } | undefined {
  let results = dbSearch(db, query, 10)
  if (fileFilter) {
    results = results.filter(r => r.file.startsWith(fileFilter))
  }
  if (results.length === 0) return undefined

  // Freshness check: skip substitution if any result file has changed on disk.
  for (const r of results) {
    const diskHash = fileHash(r.file)
    const indexedHash = dbGetFileHash(db, r.file)
    if (diskHash && indexedHash && diskHash !== indexedHash) {
      return undefined
    }
  }

  const formatted = formatSearchResults(results, projectRoot, { compact: true, snippetLines: 8 })
  const output = [
    `// index search: "${query}"`,
    formatted,
  ].join("\n")

  const savedChars = nativeOutputChars - output.length
  return { output, originalChars: nativeOutputChars, savedChars }
}

function buildGlobSubstitute(
  db: Database,
  projectRoot: string,
  pattern: string,
  nativeOutputChars: number,
): { output: string; originalChars: number; savedChars: number } | undefined {
  const files = dbFindFilesByPattern(db, pattern)
  if (files.length === 0) return undefined

  // Freshness check: skip substitution if any matching file has changed on disk.
  for (const f of files) {
    const diskHash = fileHash(f)
    const indexedHash = dbGetFileHash(db, f)
    if (diskHash && indexedHash && diskHash !== indexedHash) {
      return undefined
    }
  }

  const relFiles = files.map(f => relativeForDisplay(projectRoot, f))
  const output = [
    `// index glob: "${pattern}" (${files.length})`,
    ...relFiles,
  ].join("\n")

  const savedChars = nativeOutputChars - output.length
  return { output, originalChars: nativeOutputChars, savedChars }
}

/**
 * Try to replace a native tool output with a compact version from the index.
 */
export function tryInterceptOutput(
  db: Database | null,
  projectRoot: string,
  candidate: InterceptCandidate,
  nativeOutput: string,
  conversationContext?: ConversationContext,
): InterceptResult {
  if (!db) return { replaced: false, reason: "no database" }

  let substitute:
    | { output: string; originalChars: number; savedChars: number }
    | undefined

  const nativeOutputChars = nativeOutput.length
  if ((candidate.tool === "read" || candidate.tool === "bash-read") && candidate.resolvedPath) {
    // Freshness check: skip substitution if the file on disk differs from the index.
    // Only applies when both hashes are available (indexed file).
    const diskHash = fileHash(candidate.resolvedPath)
    const indexedHash = dbGetFileHash(db, candidate.resolvedPath)
    if (diskHash && indexedHash && diskHash !== indexedHash) {
      return { replaced: false, reason: "file changed since index; skipping stale substitute", potentialSavings: 0 }
    }
    const offset = candidate.args.offset
    const limit = candidate.args.limit
    substitute = buildFileSubstitute(db, projectRoot, candidate.resolvedPath, nativeOutputChars, offset, limit, conversationContext)
  } else if (candidate.tool === "bash-grep" && candidate.query) {
    substitute = buildSearchSubstitute(db, projectRoot, candidate.query, nativeOutputChars, candidate.resolvedPath)
  } else if (candidate.tool === "glob" && candidate.query) {
    substitute = buildGlobSubstitute(db, projectRoot, candidate.query, nativeOutputChars)
  }

  if (!substitute) {
    return { replaced: false, reason: "index has no matching content", potentialSavings: charsToTokens(nativeOutputChars) }
  }

  // In substitute mode we always use the index when it has a match, even if the
  // byte size is slightly larger, because the structured snippet is usually
  // more useful to the model than raw file contents.  Tokens saved may be
  // negative on tiny files; we clamp the recorded saving to zero.
  const tokensSaved = Math.max(0, charsToTokens(substitute.savedChars))
  return { replaced: true, output: substitute.output, tokensSaved, reason: candidate.reason }
}

function dbChunkCount(db: Database): number {
  const row = (db as any).query("SELECT count(*) as n FROM chunks_fts").get() as { n: number }
  return row.n
}
