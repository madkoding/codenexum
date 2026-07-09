import { tool, type Plugin } from "@opencode-ai/plugin"
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, statSync } from "fs"
import { join, isAbsolute, relative, extname } from "path"
import { createHash } from "crypto"

interface Chunk {
  id: string; file: string; name: string
  type: "function" | "class" | "interface" | "type" | "enum"
  line: number; content: string
}
interface Store {
  projectRoot: string | null
  chunks: Chunk[]
  indexedAt: string | null
  fileHashes: Record<string, string>
}

const HOME = process.env.HOME || "/tmp"
const DB_DIR = join(HOME, ".cache/opencode")
const DB_PATH = join(DB_DIR, "context-manager.json")

function load(): Store {
  try {
    const s = JSON.parse(readFileSync(DB_PATH, "utf-8"))
    if (!s.fileHashes) s.fileHashes = {}
    return s
  }
  catch { return { projectRoot: null, chunks: [], indexedAt: null, fileHashes: {} } }
}
function save(s: Store) {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })
  writeFileSync(DB_PATH, JSON.stringify(s))
}

const IGNORE = new Set(["node_modules","venv","_venv",".venv",".git","__pycache__",
  ".next","dist","build","target","bin","obj",".opencode",".config",".cache",
  ".vscode",".idea","vendor","elixir_build"])
const CODE_EXTS = new Set([".py",".js",".jsx",".ts",".tsx",".go",".rs",".java",
  ".rb",".php",".c",".h",".cpp",".hpp",".cs"])

function lineOf(c: string, idx: number): number {
  return c.slice(0, idx).split("\n").length
}
function hash(s: string): string {
  return createHash("md5").update(s).digest("hex")
}

function pyParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[^:]+)?\s*:/gm
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[2]}`,file:f,name:m[2],type:"function",
      line:lineOf(c,m.index),
      content:`def ${m[2]}(${m[3]})${m[4]||""}`})
  const cl = /^(\s*)class\s+(\w+)\s*(\([^)]*\))?\s*:/gm
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[2]}`,file:f,name:m[2],type:"class",
      line:lineOf(c,m.index),
      content:`class ${m[2]}${m[3]||""}`})
  return r
}
function jsParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`function ${m[1]}(${m[2]})`})
  const af = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|(\w+))\s*=>/g
  while ((m = af.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`const ${m[1]} = (${m[2]||m[3]||""}) =>`})
  const cl = /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`class ${m[1]}`})
  return r
}
function tsParse(c: string, f: string): Chunk[] {
  const r = jsParse(c, f); let m: RegExpExecArray|null
  const iface = /(?:^|\n)\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`interface ${m[1]}`})
  const ta = /(?:^|\n)\s*(?:export\s+)?type\s+(\w+)\s*=/g
  while ((m = ta.exec(c)) !== null)
    r.push({id:`${f}:type:${m[1]}`,file:f,name:m[1],type:"type",
      line:lineOf(c,m.index),
      content:`type ${m[1]}`})
  const en = /(?:^|\n)\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({id:`${f}:enum:${m[1]}`,file:f,name:m[1],type:"enum",
      line:lineOf(c,m.index),
      content:`enum ${m[1]}`})
  return r
}
function goParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /(?:^|\n)\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\([^)]*\)|\s+\w+(?:\s*\*?\w+)?)?\s*\{/g
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`func ${m[1]}(${m[2]})`})
  const st = /(?:^|\n)\s*type\s+(\w+)\s+struct\s*\{/g
  while ((m = st.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`struct ${m[1]}`})
  const iface = /(?:^|\n)\s*type\s+(\w+)\s+interface\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`interface ${m[1]}`})
  return r
}
function rsParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /(?:^|\n)\s*(?:pub\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:\s*<[^>]+>)?\s*\(([^)]*)\)(?:\s*->\s*[^{]+)?\s*\{/g
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`fn ${m[1]}(${m[2]})`})
  const st = /(?:^|\n)\s*(?:pub\s+)?struct\s+(\w+)(?:<[^>]+>)?\s*(?:\{|$)/g
  while ((m = st.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`struct ${m[1]}`})
  const en = /(?:^|\n)\s*(?:pub\s+)?enum\s+(\w+)(?:<[^>]+>)?\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({id:`${f}:enum:${m[1]}`,file:f,name:m[1],type:"enum",
      line:lineOf(c,m.index),
      content:`enum ${m[1]}`})
  const tr = /(?:^|\n)\s*(?:pub\s+)?trait\s+(\w+)(?:<[^>]+>)?\s*\{/g
  while ((m = tr.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`trait ${m[1]}`})
  return r
}
function javaParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const cl = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|static\s+)*class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`class ${m[1]}`})
  const md = /(?:^|\n)\s*(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?\s+)?(\w+)\s*\(([^)]*)\)\s*(?:throws\s+\w+(?:,\s*\w+)*)?\s*\{/g
  while ((m = md.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`method ${m[1]}(${m[2]})`})
  const iface = /(?:^|\n)\s*(?:public\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`interface ${m[1]}`})
  const en = /(?:^|\n)\s*(?:public\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({id:`${f}:enum:${m[1]}`,file:f,name:m[1],type:"enum",
      line:lineOf(c,m.index),
      content:`enum ${m[1]}`})
  return r
}
function rbParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /(?:^|\n)\s*def\s+(?:self\.)?(\w+)[\.\!\?]?\s*(?:\(([^)]*)\)|[^;\n]*)/g
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`def ${m[1]}(${m[2]||""})`})
  const cl = /(?:^|\n)\s*(?:class|module)\s+(\w+)(?:\s*<\s*\w+)?/g
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`${m[0].trim().split(/\s+/)[0]} ${m[1]}`})
  return r
}
function phpParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/g
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`function ${m[1]}(${m[2]})`})
  const cl = /(?:^|\n)\s*(?:final\s+|abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s\\]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`class ${m[1]}`})
  const iface = /(?:^|\n)\s*interface\s+(\w+)(?:\s+extends\s+[\w,\s\\]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`interface ${m[1]}`})
  const tr = /(?:^|\n)\s*trait\s+(\w+)\s*\{/g
  while ((m = tr.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`trait ${m[1]}`})
  const en = /(?:^|\n)\s*enum\s+(\w+)(?::\s*\w+)?\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({id:`${f}:enum:${m[1]}`,file:f,name:m[1],type:"enum",
      line:lineOf(c,m.index),
      content:`enum ${m[1]}`})
  return r
}
function cppParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const fn = /(?:^|\n)\s*(?:template\s*<[^>]+>\s*)?(?:static\s+|inline\s+|extern\s+|constexpr\s+)*(?:\w+\s*\*?\s+)+(\w+)\s*\(([^)]*)\)\s*(?:const\s*|noexcept\s*)*\{/g
  while ((m = fn.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`${m[1]}(${m[2]})`})
  const cl = /(?:^|\n)\s*(?:template\s*<[^>]+>\s*)?(?:final\s+)?class\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+\w+(?:<[^>]+>)?)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`class ${m[1]}`})
  const st = /(?:^|\n)\s*(?:typedef\s+)?struct\s+(\w+)\s*\{/g
  while ((m = st.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`struct ${m[1]}`})
  const ns = /(?:^|\n)\s*namespace\s+(\w+)\s*\{/g
  while ((m = ns.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`namespace ${m[1]}`})
  const en = /(?:^|\n)\s*(?:enum\s+class\s+|enum\s+struct\s+|enum\s+)(\w+)(?::\s*\w+)?\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({id:`${f}:enum:${m[1]}`,file:f,name:m[1],type:"enum",
      line:lineOf(c,m.index),
      content:`enum ${m[1]}`})
  return r
}
function csParse(c: string, f: string): Chunk[] {
  const r: Chunk[] = []; let m: RegExpExecArray|null
  const md = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+|internal\s+)?(?:static\s+|virtual\s+|override\s+|abstract\s+|async\s+|sealed\s+)*\w+(?:<[^>]+>)?\s+(\w+)\s*\(([^)]*)\)\s*\{/g
  while ((m = md.exec(c)) !== null)
    r.push({id:`${f}:fn:${m[1]}`,file:f,name:m[1],type:"function",
      line:lineOf(c,m.index),
      content:`${m[1]}(${m[2]})`})
  const cl = /(?:^|\n)\s*(?:public\s+|internal\s+|abstract\s+|sealed\s+|static\s+)*class\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*[\w,\s<>\.]+)?\s*\{/g
  while ((m = cl.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`class ${m[1]}`})
  const iface = /(?:^|\n)\s*(?:public\s+|internal\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*[\w,\s<>\.]+)?(?:\s*where\s+\w+\s*:\s*[^{]+)?\s*\{/g
  while ((m = iface.exec(c)) !== null)
    r.push({id:`${f}:iface:${m[1]}`,file:f,name:m[1],type:"interface",
      line:lineOf(c,m.index),
      content:`interface ${m[1]}`})
  const st = /(?:^|\n)\s*(?:public\s+|internal\s+)?struct\s+(\w+)(?:<[^>]+>)?\s*\{/g
  while ((m = st.exec(c)) !== null)
    r.push({id:`${f}:cls:${m[1]}`,file:f,name:m[1],type:"class",
      line:lineOf(c,m.index),
      content:`struct ${m[1]}`})
  const en = /(?:^|\n)\s*(?:public\s+|internal\s+)?enum\s+(\w+)\s*\{/g
  while ((m = en.exec(c)) !== null)
    r.push({id:`${f}:enum:${m[1]}`,file:f,name:m[1],type:"enum",
      line:lineOf(c,m.index),
      content:`enum ${m[1]}`})
  return r
}
const PARSERS: Record<string, (c: string, f: string) => Chunk[]> = {
  ".py": pyParse, ".js": jsParse, ".jsx": jsParse, ".ts": tsParse, ".tsx": tsParse,
  ".go": goParse, ".rs": rsParse, ".java": javaParse,
  ".rb": rbParse, ".php": phpParse,
  ".c": cppParse, ".h": cppParse, ".cpp": cppParse, ".hpp": cppParse, ".cs": csParse,
}

function walk(dir: string, seen: Set<string>): string[] {
  let files: string[] = []
  try {
    const real = realpathSync(dir)
    if (seen.has(real)) return []
    seen.add(real)
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!IGNORE.has(e.name)) files = files.concat(walk(join(dir, e.name), seen))
      } else if (e.isFile() && CODE_EXTS.has(extname(e.name))) {
        files.push(join(dir, e.name))
      }
    }
  } catch {}
  return files
}

function parseFile(fp: string): Chunk[] {
  const ext = extname(fp)
  const p = PARSERS[ext]
  if (!p) return []
  return p(readFileSync(fp, "utf-8"), fp)
}

function updateFile(fp: string, log?: (level: string, msg: string, extra?: Record<string, unknown>) => void): boolean {
  const ext = extname(fp)
  if (!CODE_EXTS.has(ext)) return false
  let content: string
  try { content = readFileSync(fp, "utf-8") } catch {
    log?.("warn", "failed to read file", { file: fp })
    return false
  }
  const h = hash(content)
  const db = load()
  if (db.fileHashes[fp] === h) return false
  db.chunks = db.chunks.filter(c => c.file !== fp)
  const newChunks = parseFile(fp)
  db.chunks.push(...newChunks)
  db.fileHashes[fp] = h
  save(db)
  log?.("debug", "reindexed file", { file: fp, chunks: newChunks.length })
  return true
}

function tok(s: string): string[] {
  return s.toLowerCase().match(/[a-z_]\w*/g) || []
}
function search(chunks: Chunk[], query: string, n: number): Chunk[] {
  if (query.trim().length < 2) return []
  const qt = tok(query)
  if (!qt.length) return []
  const scored = chunks.map(c => {
    const ct = tok(c.content), nt = tok(c.name)
    let s = 0
    for (const q of qt) {
      s += ct.filter(t => t === q).length * 2
      s += nt.filter(t => t === q).length * 5
      if (q.length >= 3) {
        s += ct.filter(t => t.length >= 3 && (t.includes(q) || q.includes(t))).length
        s += nt.filter(t => t.length >= 3 && (t.includes(q) || q.includes(t))).length * 2
      }
    }
    return { c, s }
  })
  return scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.c)
}

const _debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function debouncedUpdateFile(fp: string, ms = 500, log?: (level: string, msg: string, extra?: Record<string, unknown>) => void) {
  if (_debounceTimers[fp]) clearTimeout(_debounceTimers[fp])
  _debounceTimers[fp] = setTimeout(() => {
    delete _debounceTimers[fp]
    try { updateFile(fp, log) } catch {}
  }, ms)
}

function buildSystemPrompt(): string {
  const db = load()
  if (!db.chunks.length) return ""
  const fileCount = new Set(db.chunks.map(c => c.file)).size
  return [
    `<context-manager>`,
    `Code index available: ${db.chunks.length} chunks across ${fileCount} files.`,
    `Indexed: ${db.indexedAt || "unknown"}`,
    ``,
    `IMPORTANT: Use the context_search tool to find code locations BEFORE reading files.`,
    `This saves tokens — search returns function/class names with line numbers,`,
    `so you can read only the specific file and section you need.`,
    `</context-manager>`,
  ].join("\n")
}

const _plugin: Plugin = async ({ client, directory }) => {
  const log = (level: string, message: string, extra?: Record<string, unknown>) =>
    client?.app?.log({ body: { service: "context-manager", level, message, extra } }).catch(() => {})

  log("info", "plugin initialized", { directory })

  return {
    tool: {
      context_analyze: tool({
        description: "Index a project: walk code files, extract functions/classes/interfaces/types/enums, store in a searchable index. Run this once when entering a new project. The index auto-updates on file changes after that.",
        args: {
          path: tool.schema.string().optional().describe("Project path. Default: current session directory."),
        },
        async execute(args, c) {
          const root = args.path ? (isAbsolute(args.path) ? args.path : join(c.directory, args.path)) : c.directory
          const files = walk(root, new Set())
          const chunks: Chunk[] = []
          const fileHashes: Record<string, string> = {}
          for (const fp of files) {
            try {
              const content = readFileSync(fp, "utf-8")
              fileHashes[fp] = hash(content)
              const ext = extname(fp)
              const p = PARSERS[ext]
              if (p) chunks.push(...p(content, fp))
            } catch {}
          }
          save({ projectRoot: root, chunks, indexedAt: new Date().toISOString(), fileHashes })
          log("info", "indexed project", { files: files.length, chunks: chunks.length, root })
          const fns = chunks.filter(x => x.type === "function").length
          const cls = chunks.filter(x => x.type === "class").length
          const ifs = chunks.filter(x => x.type === "interface").length
          const types = chunks.filter(x => x.type === "type").length
          const enums = chunks.filter(x => x.type === "enum").length
          return [
            `Indexed ${files.length} files → ${chunks.length} chunks`,
            `  functions:  ${fns}`,
            `  classes:    ${cls}`,
            `  interfaces: ${ifs}`,
            `  types:      ${types}`,
            `  enums:      ${enums}`,
            `  DB: ${DB_PATH}`,
          ].join("\n")
        },
      }),
      context_search: tool({
        description: "Search indexed code by keyword or phrase. Use context_analyze first to build the index. Prefer this over reading files blindly to save tokens.",
        args: {
          query: tool.schema.string().describe("Search query (e.g. 'auth handler', 'validate function')"),
          n: tool.schema.number().optional().default(10).describe("Max results (default 10)"),
        },
        async execute(args) {
          const db = load()
          if (!db.chunks.length) return "No index. Run context_analyze first."
          if (args.query.trim().length < 2) return "Query too short. Use at least 2 characters."
          const results = search(db.chunks, args.query, args.n || 10)
          if (!results.length) return "No matches found."
          return results.map(c => {
            const rel = relative(db.projectRoot || "", c.file)
            return `${c.type} ${c.name} @ ${rel}:${c.line}\n  ${c.content}`
          }).join("\n\n")
        },
      }),
      context_stats: tool({
        description: "Show indexing statistics from the last context_analyze run.",
        args: {},
        async execute() {
          const db = load()
          if (!db.chunks.length) return "No index. Run context_analyze first."
          const byLang: Record<string, number> = {}
          for (const c of db.chunks) {
            const ext = extname(c.file)
            byLang[ext] = (byLang[ext] || 0) + 1
          }
          const lines = [
            `Project: ${db.projectRoot}`,
            `Indexed: ${db.indexedAt}`,
            `Total:   ${db.chunks.length} chunks`,
          ]
          for (const [ext, n] of Object.entries(byLang).sort((a, b) => b[1] - a[1]))
            lines.push(`  ${ext}: ${n}`)
          lines.push(`Files:   ${new Set(db.chunks.map(c => c.file)).size}`)
          return lines.join("\n")
        },
      }),
      context_clear: tool({
        description: "Delete the local code index.",
        args: {},
        async execute() {
          save({ projectRoot: null, chunks: [], indexedAt: null, fileHashes: {} })
          return "Index cleared."
        },
      }),
    },
    async event({ event }) {
      if (event.type === "file.edited" && event.properties?.file) {
        debouncedUpdateFile(event.properties.file, 500, log)
      }
      if (event.type === "file.watcher.updated" && event.properties?.file) {
        const fp = event.properties.file
        const ev = event.properties.event
        if (ev === "unlink") {
          const db = load()
          db.chunks = db.chunks.filter(c => c.file !== fp)
          delete db.fileHashes[fp]
          save(db)
          log("debug", "removed file from index", { file: fp })
        } else if (ev === "add" || ev === "change") {
          debouncedUpdateFile(fp, 500, log)
        }
      }
    },
    async "experimental.chat.system.transform"(_input, output) {
      const prompt = buildSystemPrompt()
      if (prompt) output.system.push(prompt)
    },
  }
}
export default { id: "@madkoding/context-manager", server: _plugin }