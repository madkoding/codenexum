import { tool, type Plugin, type PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync, writeFileSync, statSync } from "fs"
import { join } from "path"

const HOME = process.env.HOME || "/tmp"
const MCP_CONFIG_PATH = join(HOME, ".config", "codenexum", "mcp.json")
const PERSISTENT_CACHE_PATH = join(HOME, ".config", "codenexum", "snippet-cache.json")

function getMcpUrl(): string | null {
  if (process.env.CODENEXUM_MCP_URL) return process.env.CODENEXUM_MCP_URL
  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"))
      return cfg.url || `http://127.0.0.1:${cfg.port}`
    } catch { /* ignore */ }
  }
  return null
}

const NOT_RUNNING = "CodeNexum app is not running. Install it from https://github.com/madkoding/codenexum or start it manually."

async function callMcpJson(toolName: string, args: Record<string, any>): Promise<any> {
  const url = getMcpUrl()
  if (!url) return null
  try {
    const res = await fetch(`${url}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolName, args }),
    })
    const data = (await res.json()) as { result?: any }
    if (!res.ok) return null
    return data.result ?? data
  } catch { return null }
}

async function callMcp(toolName: string, args: Record<string, any>): Promise<string> {
  const result = await callMcpJson(toolName, args)
  if (result === null) return NOT_RUNNING
  return typeof result === "string" ? result : JSON.stringify(result)
}

function charsToTokens(chars: number): number {
  return chars ? Math.max(0, Math.round(chars / 4)) : 0
}

interface CallInfo {
  tool: string
  path?: string
  query?: string
  projectDir: string
}

const pendingCalls = new Map<string, CallInfo>()

const indexedProjects = new Set<string>()
const indexingInFlight = new Set<string>()

async function ensureProjectIndexed(projectDir: string) {
  if (!projectDir) return
  if (indexedProjects.has(projectDir) || indexingInFlight.has(projectDir)) return
  indexingInFlight.add(projectDir)
  try {
    const ok = await callMcpJson("cm_analyze", { path: projectDir })
    if (ok !== null) {
      indexedProjects.add(projectDir)
      pluginLog(`indexed project: ${projectDir}`)
    } else {
      pluginLog(`cm_analyze unavailable for ${projectDir}`, "warn")
    }
  } catch (e: any) {
    pluginLog(`cm_analyze failed for ${projectDir}: ${e?.message || e}`, "warn")
  } finally {
    indexingInFlight.delete(projectDir)
  }
}

interface CacheEntry { output: string; ts: number; mtime?: number; filePath?: string }

const sessionReadCounts = new Map<string, { count: number; firstSeen: number }>()
const LOOP_THRESHOLD = 3
const LOOP_WINDOW_MS = 5 * 60 * 1000

let persistentCache = new Map<string, CacheEntry>()
let persistentCacheLoaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadPersistentCache(persistentEnabled: boolean) {
  if (persistentCacheLoaded) return
  persistentCacheLoaded = true
  if (!persistentEnabled) return
  if (!existsSync(PERSISTENT_CACHE_PATH)) return
  try {
    const data = JSON.parse(readFileSync(PERSISTENT_CACHE_PATH, "utf-8")) as Record<string, CacheEntry>
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v.output === "string" && v.ts > cutoff) {
        persistentCache.set(k, v)
      }
    }
  } catch {}
}

function schedulePersistentSave(persistentEnabled: boolean) {
  if (!persistentEnabled) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const obj = Object.fromEntries(persistentCache)
      writeFileSync(PERSISTENT_CACHE_PATH, JSON.stringify(obj))
    } catch {}
  }, 5000)
}

function cacheGet(key: string, ttlMs: number, filePath?: string): string | null {
  const entry = persistentCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) {
    persistentCache.delete(key)
    return null
  }
  if (filePath && entry.filePath === filePath && entry.mtime !== undefined) {
    try {
      const stat = statSync(filePath)
      if (stat.mtimeMs > entry.mtime) {
        persistentCache.delete(key)
        return null
      }
    } catch {}
  }
  return entry.output
}

function cacheSet(key: string, output: string, maxEntries: number, filePath?: string): void {
  if (persistentCache.size >= maxEntries) {
    const first = persistentCache.keys().next().value
    if (first) persistentCache.delete(first)
  }
  const entry: CacheEntry = { output, ts: Date.now() }
  if (filePath) {
    entry.filePath = filePath
    try { entry.mtime = statSync(filePath).mtimeMs } catch {}
  }
  persistentCache.set(key, entry)
  schedulePersistentSave(true)
}

const COMPRESSIBLE_TOOL_IDS = new Set([
  "read", "bash", "sh", "zsh", "fish", "shell",
  "grep", "glob", "rg", "fd", "find",
  "npm", "yarn", "pnpm", "node", "npx", "tsc",
  "git", "curl", "wget", "ssh", "scp",
  "test", "jest", "vitest", "pytest", "cargo",
  "build", "make", "cmake",
])

function isCompressibleTool(toolID: string): boolean {
  return COMPRESSIBLE_TOOL_IDS.has(toolID) || toolID.startsWith("bash") || toolID.startsWith("sh")
}

interface PluginSettings {
  readInterception: boolean
  grepInterception: boolean
  autoCompress: boolean
  cache: boolean
  turnSavingsLog: boolean
  persistentCache: boolean
  compressThreshold: number
  cacheTtlMs: number
  cacheMaxEntries: number
}

let cachedSettings: PluginSettings | null = null
let settingsFetchedAt = 0
const SETTINGS_TTL = 30 * 1000

function getSettings(): Promise<PluginSettings> {
  if (cachedSettings && Date.now() - settingsFetchedAt < SETTINGS_TTL) return Promise.resolve(cachedSettings)
  const url = getMcpUrl()
  if (!url) return Promise.resolve(defaultSettings())
  return (async () => {
    try {
      const res = await fetch(`${url}/api/settings`)
      if (!res.ok) return defaultSettings()
      const data = await res.json()
      cachedSettings = { ...defaultSettings(), ...sanitizeSettings(data) }
      settingsFetchedAt = Date.now()
      return cachedSettings!
    } catch {
      return defaultSettings()
    }
  })()
}

function sanitizeSettings(data: Partial<PluginSettings>): Partial<PluginSettings> {
  const safe: Record<string, any> = {}
  if (typeof data.compressThreshold === "number" && Number.isFinite(data.compressThreshold) && data.compressThreshold >= 0) safe.compressThreshold = data.compressThreshold
  if (typeof data.cacheTtlMs === "number" && Number.isFinite(data.cacheTtlMs) && data.cacheTtlMs >= 0) safe.cacheTtlMs = data.cacheTtlMs
  if (typeof data.cacheMaxEntries === "number" && Number.isFinite(data.cacheMaxEntries) && data.cacheMaxEntries >= 0) safe.cacheMaxEntries = Math.round(data.cacheMaxEntries)
  if (typeof data.readInterception === "boolean") safe.readInterception = data.readInterception
  if (typeof data.grepInterception === "boolean") safe.grepInterception = data.grepInterception
  if (typeof data.autoCompress === "boolean") safe.autoCompress = data.autoCompress
  if (typeof data.cache === "boolean") safe.cache = data.cache
  if (typeof data.turnSavingsLog === "boolean") safe.turnSavingsLog = data.turnSavingsLog
  if (typeof data.persistentCache === "boolean") safe.persistentCache = data.persistentCache
  return safe
}

function defaultSettings(): PluginSettings {
  return {
    readInterception: true,
    grepInterception: true,
    autoCompress: true,
    cache: true,
    turnSavingsLog: true,
    persistentCache: true,
    compressThreshold: 8000,
    cacheTtlMs: 5 * 60 * 1000,
    cacheMaxEntries: 200,
  }
}

export function detectCandidate(tool: string, args: any, projectDir: string, settings: PluginSettings): CallInfo | null {
  if (!projectDir) return null

  if (tool === "read" && settings.readInterception) {
    const filePath = args?.filePath || args?.path || ""
    const absPath = filePath.startsWith("/") ? filePath : join(projectDir, filePath)
    if (absPath.startsWith(projectDir)) {
      return { tool: "read", path: absPath, projectDir }
    }
    return null
  }

  if (tool === "grep" && settings.grepInterception) {
    const query = args?.pattern || args?.query || ""
    if (query) return { tool: "grep", query, projectDir }
    return null
  }

  if (tool === "glob" && settings.grepInterception) {
    const pattern = args?.pattern || args?.glob || ""
    if (pattern) return { tool: "glob", query: pattern, projectDir }
    return null
  }

  if (tool === "bash" || tool === "sh" || tool === "zsh" || tool === "fish" || tool === "shell") {
    const cmd = (args?.command || args?.cmd || "").trim()
    if (!cmd) return null

    const resolveFile = (raw: string): string | null => {
      const cleaned = raw.replace(/^~/, HOME).replace(/^["']|["']$/g, "")
      const abs = cleaned.startsWith("/") ? cleaned : join(projectDir, cleaned)
      return abs.startsWith(projectDir) ? abs : null
    }

    const tokenize = (s: string): { flags: string; operands: string[] } => {
      const tokens: string[] = []
      let cur = ""
      let quote: string | null = null
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (quote) {
          if (ch === quote) quote = null
          else cur += ch
        } else if (ch === '"' || ch === "'") {
          quote = ch
        } else if (ch === " " || ch === "\t") {
          if (cur) { tokens.push(cur); cur = "" }
        } else {
          cur += ch
        }
      }
      if (cur) tokens.push(cur)
      const flags: string[] = []
      const operands: string[] = []
      for (const t of tokens) {
        if (t.startsWith("-") && !/^-\d/.test(t) && !/\.\w+$/.test(t)) flags.push(t)
        else operands.push(t)
      }
      return { flags: flags.join(" "), operands }
    }

    const isPath = (s: string): boolean => /\.\w+$/.test(s) || s.startsWith("/") || s.startsWith("./") || s.startsWith("../") || s.includes("/")

    const head = cmd.split(/\s+/, 1)[0]
    const after = cmd.slice(head.length).trim()
    const { flags, operands } = tokenize(after)

    const readCmds = new Set(["cat", "head", "tail", "less", "more", "bat", "batcat", "xxd", "strings", "base64",
                              "md5sum", "sha1sum", "sha256sum", "wc", "file", "stat", "du", "fold", "column", "rev",
                              "awk", "sed", "cut", "tr", "sort", "uniq", "nl", "paste", "comm", "join", "tac", "dd",
                              "iconv", "od", "hexdump", "tokei", "scc", "cloc"])
    if (readCmds.has(head) && settings.readInterception) {
      const fileOp = operands.find(isPath)
      if (fileOp) {
        const path = resolveFile(fileOp)
        if (path) return { tool: "bash-read", path, projectDir }
      }
    }

    const grepCmds = new Set(["grep", "rg", "ripgrep", "ag", "ack", "pt", "sift", "ugrep"])
    if (grepCmds.has(head) && settings.grepInterception) {
      const patternOp = operands[0]
      const fileOp = operands.slice(1).find(isPath)
      if (patternOp && fileOp && !patternOp.startsWith("-")) {
        const path = resolveFile(fileOp)
        if (path) return { tool: "bash-grep", path, query: patternOp, projectDir }
      }
    }

    if (head === "git" && operands[0]) {
      const sub = operands[0]
      const subArgs = operands.slice(1)
      if (sub === "grep" && settings.grepInterception) {
        const patternOp = subArgs[0]
        const sepIdx = subArgs.indexOf("--")
        const afterSep = sepIdx >= 0 ? subArgs.slice(sepIdx + 1) : subArgs
        const fileOp = afterSep.slice(1).find(isPath)
        if (patternOp && fileOp && !patternOp.startsWith("-")) {
          const path = resolveFile(fileOp)
          if (path) return { tool: "bash-grep", path, query: patternOp, projectDir }
        }
      }
      if ((sub === "show" || sub === "diff" || sub === "log") && settings.readInterception) {
        const fileOp = subArgs.find(o => isPath(o) || /^\S+:\S+/.test(o))
        if (fileOp) {
          const cleanPath = fileOp.replace(/^[^:]+:/, "")
          if (isPath(cleanPath)) {
            const path = resolveFile(cleanPath)
            if (path) return { tool: "bash-read", path, projectDir }
          }
        }
      }
    }

    if (head === "jq" && settings.grepInterception) {
      const queryOp = operands[0]
      const fileOp = operands.slice(1).find(isPath)
      if (queryOp && fileOp) {
        const path = resolveFile(fileOp)
        if (path) return { tool: "bash-grep", path, query: queryOp, projectDir }
      }
    }

    return null
  }

  if (tool === "webfetch") {
    const url = (args?.url || args?.link || "").toString()
    if (url) return { tool: "webfetch", path: url, projectDir }
    return null
  }

  if (tool === "websearch") {
    const query = (args?.query || args?.term || args?.q || "").toString()
    if (query) return { tool: "websearch", query, projectDir }
    return null
  }

  return null
}

const cmSearch = tool({
  description: "Search indexed code by keyword. Supports filters like class:User, function:auth, file:auth.ts, lang:ts.",
  args: {
    query: tool.schema.string().describe("Search query"),
    n: tool.schema.number().optional().default(10),
  },
  async execute(args, c) {
    return callMcp("cm_search", { ...args, projectDir: c.directory || "" })
  },
})

const cmRelated = tool({
  description: "Show symbols related to a given file:symbol — callers, callees, imports, extends, implements.",
  args: {
    symbol: tool.schema.string().describe("Symbol to trace"),
    n: tool.schema.number().optional().default(10),
  },
  async execute(args, c) {
    return callMcp("cm_related", { ...args, projectDir: c.directory || "" })
  },
})

const cmImpact = tool({
  description: "Find files/symbols that depend on the given files.",
  args: {
    files: tool.schema.array(tool.schema.string()).describe("File paths"),
    n: tool.schema.number().optional().default(10),
  },
  async execute(args, c) {
    return callMcp("cm_impact", { ...args, projectDir: c.directory || "" })
  },
})

const cmStats = tool({
  description: "Show index stats: project root, timestamp, chunk counts by language, context fill %.",
  args: {},
  async execute(_, c) {
    return callMcp("cm_stats", { projectDir: c.directory || "" })
  },
})

const cmCompression = tool({
  description: "Show compression status and diagnostics.",
  args: {},
  async execute(_, c) {
    return callMcp("cm_compression", { projectDir: c.directory || "" })
  },
})

const cmAnalyze = tool({
  description: "Index/analyze a project path.",
  args: { path: tool.schema.string().optional().describe("Project path to index") },
  async execute(args, c) {
    return callMcp("cm_analyze", { path: args.path || c.directory || process.cwd() })
  },
})

const cmDashboard = tool({
  description: "Open the CodeNexum web dashboard.",
  args: {},
  async execute() {
    const url = getMcpUrl()
    if (!url) return NOT_RUNNING
    try {
      const res = await fetch(`${url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "cm_dashboard", args: {} }),
      })
      const data = (await res.json()) as { result?: any }
      return data.result ?? data ?? "Dashboard opened"
    } catch { return "Dashboard unavailable" }
  },
})

const turnSavings = new Map<string, { sessionID: string; tokensSaved: number; toolsIntercepted: number; ts: number }>()

function recordTurnSavings(sessionID: string, saved: number) {
  if (!sessionID) return
  const cur = turnSavings.get(sessionID) || { sessionID, tokensSaved: 0, toolsIntercepted: 0, ts: Date.now() }
  cur.tokensSaved += saved
  cur.toolsIntercepted += 1
  cur.ts = Date.now()
  turnSavings.set(sessionID, cur)
}

async function flushTurnSavings(sessionID: string) {
  const cur = turnSavings.get(sessionID)
  if (!cur || cur.tokensSaved === 0) return
  const projectDir = pluginDirectory
  await callMcpJson("cm_log_event", {
    projectDir,
    eventType: "turn_savings",
    tokensSaved: cur.tokensSaved,
    meta: { sessionID, toolsIntercepted: cur.toolsIntercepted, durationMs: Date.now() - cur.ts },
  })
  turnSavings.delete(sessionID)
}

let pluginLog: (msg: string, level?: "debug" | "info" | "warn" | "error") => void = () => {}
let pluginClient: PluginInput["client"] | null = null
let pluginDirectory: string = process.cwd()

export const plugin: Plugin = async (input: PluginInput) => {
  pluginClient = input.client
  pluginDirectory = input.directory || process.cwd()
  pluginLog = (msg, level = "info") => {
    try {
      const body: any = { service: "codenexum", level, message: msg }
      pluginClient?.app.log({ body }).catch(() => {})
    } catch {}
  }
  pluginLog(`plugin loaded, cwd=${pluginDirectory}`)
  loadPersistentCache(true)
  void ensureProjectIndexed(pluginDirectory)
  return {
    event: async ({ event }) => {
      pluginLog(`event: ${event.type}`)
      if (event.type === "session.idle") {
        const sessionID = (event as { properties?: { sessionID?: string } }).properties?.sessionID
        if (sessionID) await flushTurnSavings(sessionID)
      }
    },
    "tool.execute.before": async (toolInput, output) => {
      const t = toolInput?.tool || ""
      const callID = toolInput?.callID || ""
      const sessionID = toolInput?.sessionID || ""
      if (!t || !callID) return

      const args = output?.args
      if (!args) return

      const projectDir = input.directory || process.cwd()
      if (input.directory && input.directory !== pluginDirectory) {
        pluginDirectory = input.directory
        pluginLog(`project changed to ${pluginDirectory}`)
      }
      void ensureProjectIndexed(projectDir)
      const settings = await getSettings()
      const candidate = detectCandidate(t, args, projectDir, settings)
      if (candidate) pendingCalls.set(callID, candidate)
    },
    "tool.execute.after": async (toolInput, output) => {
      const t = toolInput?.tool || ""
      const callID = toolInput?.callID || ""
      const sessionID = toolInput?.sessionID || ""
      if (!t || !callID) return

      const info = pendingCalls.get(callID)
      if (info) pendingCalls.delete(callID)

      const cur = (output as { output?: string })?.output
      if (typeof cur !== "string") return

      const settings = await getSettings()
      const projectDir = info?.projectDir || input.directory || process.cwd()

      try {
        let substitute: string | null = null
        let cached = false

        if (info && (info.tool === "read" || info.tool === "bash-read")) {
          const cacheKey = `read:${info.projectDir}:${(info.path as string)}`
          const now = Date.now()
          const seen = sessionReadCounts.get(info.path as string)
          const count = seen && now - seen.firstSeen < LOOP_WINDOW_MS ? seen.count + 1 : 1
          sessionReadCounts.set(info.path as string, { count, firstSeen: seen?.firstSeen || now })

          if (count >= LOOP_THRESHOLD) {
            const hint = `[codenexum] This file has been read ${count} times in this session. The indexed chunks are already available. Use the context_search tool to query specific symbols or functions instead of re-reading the entire file.`
            if (hint.length < cur.length) {
              const nativeChars = cur.length
              const saved = Math.max(0, charsToTokens(nativeChars - hint.length))
              ;(output as { output: string }).output = substituteString(cur, hint)
              void callMcpJson("cm_log_event", {
                projectDir: info.projectDir,
                eventType: "loop_detected",
                tokensSaved: saved,
                meta: { tool: info.tool, path: info.path, count, nativeChars, substituteChars: hint.length },
              })
              if (settings.turnSavingsLog) recordTurnSavings(sessionID, saved)
              return
            }
          }

          if (settings.cache) {
            const cachedValue = cacheGet(cacheKey, settings.cacheTtlMs, info.path)
            if (cachedValue !== null) {
              substitute = cachedValue
              cached = true
            }
          }
          if (substitute === null) {
            const snippet = await callMcpJson("cm_read_snippet", {
              path: info.projectDir,
              filePath: info.path,
            })
            if (snippet && snippet.result != null) {
              substitute = String(snippet.result)
              if (settings.cache) cacheSet(cacheKey, substitute!, settings.cacheMaxEntries, info.path)
            }
          }
        } else if (info && (info.tool === "grep" || info.tool === "glob" || info.tool === "bash-grep")) {
          const cacheKey = `grep:${info.projectDir}:${(info.query as string)}:${info.path || ""}`
          if (settings.cache) {
            const cachedValue = cacheGet(cacheKey, settings.cacheTtlMs)
            if (cachedValue !== null) {
              substitute = cachedValue
              cached = true
            }
          }
          if (substitute === null) {
            const result = await callMcpJson("cm_search_snippet", {
              path: info.projectDir,
              query: info.query,
              ...(info.path ? { fileFilter: info.path } : {}),
            })
            if (result && result.result != null) {
              substitute = String(result.result)
              if (settings.cache) cacheSet(cacheKey, substitute!, settings.cacheMaxEntries)
            }
          }
        } else if (info?.tool === "webfetch" && settings.cache) {
          const cacheKey = `webfetch:${info.path}`
          const cachedValue = cacheGet(cacheKey, settings.cacheTtlMs)
          if (cachedValue !== null) {
            substitute = cachedValue
            cached = true
          } else {
            cacheSet(cacheKey, cur, settings.cacheMaxEntries)
          }
        } else if (info?.tool === "websearch" && settings.cache) {
          const cacheKey = `websearch:${info.query}`
          const cachedValue = cacheGet(cacheKey, settings.cacheTtlMs)
          if (cachedValue !== null) {
            substitute = cachedValue
            cached = true
          } else {
            cacheSet(cacheKey, cur, settings.cacheMaxEntries)
          }
        }

        if (substitute && substitute.length < cur.length) {
          const nativeChars = cur.length
          const saved = Math.max(0, charsToTokens(nativeChars - substitute.length))
          ;(output as { output: string }).output = substituteString(cur, substitute)
          void callMcpJson("cm_log_event", {
            projectDir: info!.projectDir,
            eventType: "index_substitute",
            tokensSaved: saved,
            meta: { tool: info!.tool, path: info!.path, query: info!.query, nativeChars, substituteChars: substitute.length, cached },
          })
          void callMcpJson("cm_log_event", {
            projectDir: info!.projectDir,
            eventType: "file_read",
            tokensSaved: 0,
            meta: { tool: info!.tool, path: info!.path },
          })
          if (settings.turnSavingsLog) recordTurnSavings(sessionID, saved)
          return
        }

        if (settings.autoCompress && cur.length > settings.compressThreshold && isCompressibleTool(t)) {
          const compressed = await callMcpJson("cm_compress_output", {
            toolID: t,
            output: cur,
          })
          if (compressed && typeof compressed.result === "string" && compressed.result.length < cur.length) {
            const saved = Math.max(0, charsToTokens(cur.length - compressed.result.length))
            ;(output as { output: string }).output = substituteString(cur, compressed.result)
            void callMcpJson("cm_log_event", {
              projectDir,
              eventType: "compression",
              tokensSaved: saved,
              meta: { tool: t, nativeChars: cur.length, compressedChars: compressed.result.length, interceptSource: info ? "read-grep-fallback" : "generic" },
            })
            if (settings.turnSavingsLog) recordTurnSavings(sessionID, saved)
          }
        }
      } catch (e: any) {
        pluginLog(`tool.execute.after failed: ${e?.message || e}`, "warn")
      }
    },
    tool: {
      context_search: cmSearch,
      context_related: cmRelated,
      context_impact: cmImpact,
      context_stats: cmStats,
      context_compression: cmCompression,
      context_analyze: cmAnalyze,
      context_dashboard: cmDashboard,
    },
  }
}

function substituteString(original: string, replacement: string): string {
  if (replacement.length <= original.length) return replacement
  return replacement.slice(0, original.length)
}

export default plugin
