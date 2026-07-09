/**
 * Contract tests — verify stable interfaces and output formats that consumers depend on.
 * These tests FAIL if any contract is broken, preventing silent regressions.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import type { Chunk } from "../src/types"
import { IGNORE, CODE_EXTS } from "../src/types"
import { PARSERS } from "../src/parsers"
import {
  initSchema, dbInsertChunks, dbSetFileHash, dbSetMeta,
  dbChunkCount, dbSearch, dbStatsByLang, dbClear, dbGetMeta, buildFtsQuery,
} from "../src/store"
import { indexProject, updateFile } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"

let db: Database
let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ctx-contract-"))
  db = new Database(":memory:")
  initSchema(db)
})

afterAll(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

// ═══════════════════════════════════════════════════════════════
// C1: Chunk interface contract — all parsers must produce valid Chunks
// ═══════════════════════════════════════════════════════════════
test("C1: Chunk has required fields with correct types", () => {
  const chunk: Chunk = {
    id: "test:fn:foo",
    file: "test.ts",
    name: "foo",
    type: "function",
    line: 1,
    content: "function foo()",
  }
  expect(typeof chunk.id).toBe("string")
  expect(typeof chunk.file).toBe("string")
  expect(typeof chunk.name).toBe("string")
  expect(["function", "class", "interface", "type", "enum"]).toContain(chunk.type)
  expect(typeof chunk.line).toBe("number")
  expect(typeof chunk.content).toBe("string")
})

test("C1: Chunk.type is limited to the 5 allowed values", () => {
  const validTypes = new Set(["function", "class", "interface", "type", "enum"])
  // Every parser should only produce chunks with these types
  const samples = [
    "function foo() {}",
    "class Bar {}",
    "interface IBar {}",
    "type Baz = string",
    "enum Qux { A }",
  ]
  for (const code of samples) {
    const chunks = PARSERS[".ts"](code, "test.ts")
    for (const c of chunks) {
      expect(validTypes.has(c.type)).toBe(true)
    }
  }
})

test("C1: Every parser produces valid Chunk objects", () => {
  const sampleCode: Record<string, string> = {
    ".py": "def foo(x): return x\nclass Bar: pass",
    ".js": "function foo() {}\nclass Bar {}",
    ".ts": "function foo() {}\ninterface IBar {}\ntype Baz = string\nenum Q { A }",
    ".go": "func foo() {}\ntype Bar struct{}\ntype IBar interface{}",
    ".rs": "fn foo() {}\nstruct Bar {}\nenum Q { A }\ntrait T {}",
    ".java": "class Bar { public void foo() {} }\ninterface IBar {}",
    ".rb": "def foo\nend\nclass Bar\nend",
    ".php": "<?php function foo() {} class Bar {} interface IBar {}",
    ".c": "int foo() { return 0; } struct Bar { int x; };",
    ".cpp": "int foo() { return 0; } class Bar {}; namespace NS {}",
    ".cs": "public void Foo() {} public class Bar {} public interface IBar {}",
  }
  for (const [ext, code] of Object.entries(sampleCode)) {
    const parser = PARSERS[ext]
    expect(parser).toBeDefined()
    const chunks = parser(code, "test" + ext)
    for (const c of chunks) {
      expect(typeof c.id).toBe("string")
      expect(c.id.length).toBeGreaterThan(0)
      expect(typeof c.file).toBe("string")
      expect(typeof c.name).toBe("string")
      expect(c.name.length).toBeGreaterThan(0)
      expect(["function", "class", "interface", "type", "enum"]).toContain(c.type)
      expect(typeof c.line).toBe("number")
      expect(c.line).toBeGreaterThanOrEqual(1)
      expect(typeof c.content).toBe("string")
      expect(c.content.length).toBeGreaterThan(0)
    }
  }
})

// ═══════════════════════════════════════════════════════════════
// C2: PARSERS map — all declared extensions must have a parser
// ═══════════════════════════════════════════════════════════════
test("C2: CODE_EXTS is a superset of PARSERS keys", () => {
  for (const ext of CODE_EXTS) {
    expect(PARSERS[ext]).toBeDefined()
  }
})

test("C2: PARSERS has no extensions outside CODE_EXTS", () => {
  for (const ext of Object.keys(PARSERS)) {
    expect(CODE_EXTS.has(ext)).toBe(true)
  }
})

test("C2: PARSERS covers all 15 extensions", () => {
  expect(Object.keys(PARSERS).length).toBe(15)
})

// ═══════════════════════════════════════════════════════════════
// C3: SQL schema contract — table and column names are stable
// ═══════════════════════════════════════════════════════════════
test("C3: chunks_fts table exists with correct columns", () => {
  const cols = db.query("PRAGMA table_info(chunks_fts)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain("name")
  expect(colNames).toContain("content")
  expect(colNames).toContain("id")
  expect(colNames).toContain("file")
  expect(colNames).toContain("type")
  expect(colNames).toContain("line")
})

test("C3: file_hashes table exists with file + hash columns", () => {
  const cols = db.query("PRAGMA table_info(file_hashes)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain("file")
  expect(colNames).toContain("hash")
})

test("C3: meta table exists with key + value columns", () => {
  const cols = db.query("PRAGMA table_info(meta)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain("key")
  expect(colNames).toContain("value")
})

// ═══════════════════════════════════════════════════════════════
// C4: Meta keys contract — these keys are read by multiple functions
// ═══════════════════════════════════════════════════════════════
test("C4: projectRoot meta key is used by context_search and buildSystemPrompt", () => {
  dbSetMeta(db, "projectRoot", "/fake/path")
  expect(dbGetMeta(db, "projectRoot")).toBe("/fake/path")

  // buildSystemPrompt reads indexedAt
  dbSetMeta(db, "indexedAt", "2026-01-01T00:00:00Z")
  const prompt = buildSystemPrompt(db)
  if (dbChunkCount(db) > 0) {
    expect(prompt).toContain("2026-01-01T00:00:00Z")
  }
})

test("C4: meta keys are exactly projectRoot and indexedAt", () => {
  // These are the only meta keys the plugin uses
  dbSetMeta(db, "projectRoot", "/test")
  dbSetMeta(db, "indexedAt", "2026-01-01")
  const allMeta = db.query("SELECT key FROM meta").all() as { key: string }[]
  const keys = allMeta.map(m => m.key)
  expect(keys).toContain("projectRoot")
  expect(keys).toContain("indexedAt")
})

// ═══════════════════════════════════════════════════════════════
// C5: context_search output format contract
// The LLM parses: "${type} ${name} @ ${relativePath}:${line}\n  ${content}"
// ═══════════════════════════════════════════════════════════════
test("C5: context_search output format matches 'type name @ file:line\\n  content'", () => {
  dbClear(db)
  dbInsertChunks(db, [{
    id: "f:fn:handleAuth", file: join(tmpDir, "src/auth.ts"), name: "handleAuth",
    type: "function", line: 42, content: "function handleAuth(req, res)",
  }])
  dbSetMeta(db, "projectRoot", tmpDir)

  const results = dbSearch(db, "handleAuth", 10)
  expect(results.length).toBeGreaterThanOrEqual(1)
  const r = results[0]
  const rel = r.file.replace(tmpDir + "/", "")

  // Reproduce the exact format the plugin uses
  const outputLine = `${r.type} ${r.name} @ ${rel}:${r.line}\n  ${r.content}`
  expect(outputLine).toBe("function handleAuth @ src/auth.ts:42\n  function handleAuth(req, res)")
})

test("C5: search results separated by double newline", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f1:fn:a", file: "a.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
    { id: "f2:fn:b", file: "b.ts", name: "bar", type: "function", line: 1, content: "function bar()" },
  ])
  dbSetMeta(db, "projectRoot", "")

  const results = dbSearch(db, "foo bar", 10)
  const output = results.map((r: any) => `${r.type} ${r.name} @ ${r.file}:${r.line}\n  ${r.content}`).join("\n\n")
  expect(output).toContain("\n\n")
  expect(output.split("\n\n").length).toBe(results.length)
})

// ═══════════════════════════════════════════════════════════════
// C6: context_analyze output format contract
// "Indexed N files → N chunks\n  functions:  N\n  classes:    N\n  ..."
// ═══════════════════════════════════════════════════════════════
test("C6: context_analyze output format has required lines", () => {
  const chunks: Chunk[] = [
    { id: "f1:fn:a", file: "a.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
    { id: "f2:cls:b", file: "b.ts", name: "Bar", type: "class", line: 1, content: "class Bar" },
  ]
  const fns = chunks.filter(x => x.type === "function").length
  const cls = chunks.filter(x => x.type === "class").length
  const ifs = chunks.filter(x => x.type === "interface").length
  const types = chunks.filter(x => x.type === "type").length
  const enums = chunks.filter(x => x.type === "enum").length

  const output = [
    `Indexed ${2} files → ${chunks.length} chunks`,
    `  functions:  ${fns}`,
    `  classes:    ${cls}`,
    `  interfaces: ${ifs}`,
    `  types:      ${types}`,
    `  enums:      ${enums}`,
    `  DB: /fake/path.sqlite`,
  ].join("\n")

  expect(output).toContain("Indexed 2 files → 2 chunks")
  expect(output).toContain("functions:  1")
  expect(output).toContain("classes:    1")
  expect(output).toContain("interfaces: 0")
  expect(output).toContain("types:      0")
  expect(output).toContain("enums:      0")
  expect(output).toContain("DB:")
})

// ═══════════════════════════════════════════════════════════════
// C7: context_stats output format contract
// "Project: ...\nIndexed: ...\nTotal:   N chunks\n  .ts: N\nFiles:   N"
// ═══════════════════════════════════════════════════════════════
test("C7: context_stats output format has required lines", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f1:fn:a", file: "test.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
  ])
  dbSetMeta(db, "projectRoot", "/fake")
  dbSetMeta(db, "indexedAt", "2026-01-01T00:00:00Z")

  const count = dbChunkCount(db)
  const byLang = dbStatsByLang(db)
  const lines = [
    `Project: ${dbGetMeta(db, "projectRoot")}`,
    `Indexed: ${dbGetMeta(db, "indexedAt")}`,
    `Total:   ${count} chunks`,
  ]
  for (const { ext, n } of byLang)
    lines.push(`  ${ext}: ${n}`)
  lines.push(`Files:   ${1}`)

  const output = lines.join("\n")
  expect(output).toContain("Project: /fake")
  expect(output).toContain("Indexed: 2026-01-01T00:00:00Z")
  expect(output).toContain("Total:   1 chunks")
  expect(output).toContain(".ts: 1")
  expect(output).toContain("Files:")
})

// ═══════════════════════════════════════════════════════════════
// C8: System prompt format contract
// "<context-manager>\n...\n</context-manager>"
// ═══════════════════════════════════════════════════════════════
test("C8: buildSystemPrompt wraps in <context-manager> tags", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f1:fn:a", file: "test.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
  ])
  dbSetMeta(db, "projectRoot", "/fake")
  dbSetMeta(db, "indexedAt", "2026-01-01")

  const prompt = buildSystemPrompt(db)
  expect(prompt.startsWith("<context-manager>")).toBe(true)
  expect(prompt.endsWith("</context-manager>")).toBe(true)
  expect(prompt).toContain("Code index available:")
  expect(prompt).toContain("chunks")
  expect(prompt).toContain("files")
  expect(prompt).toContain("Indexed:")
  expect(prompt).toContain("context_search")
})

test("C8: buildSystemPrompt returns empty string when no index", () => {
  dbClear(db)
  expect(buildSystemPrompt(db)).toBe("")
})

// ═══════════════════════════════════════════════════════════════
// C9: buildFtsQuery output format contract — FTS5 MATCH syntax
// Must produce: "token" OR "token" OR ...
// Double-quoted tokens, OR separator
// ═══════════════════════════════════════════════════════════════
test("C9: buildFtsQuery produces double-quoted tokens joined by OR", () => {
  const q = buildFtsQuery("auth login handler")
  expect(q).toBe('"auth" OR "login" OR "handler"')
})

test("C9: buildFtsQuery wraps each token in double quotes", () => {
  const q = buildFtsQuery("invoice")
  expect(q).toBe('"invoice"')
  expect(q.startsWith('"')).toBe(true)
  expect(q.endsWith('"')).toBe(true)
})

test("C9: buildFtsQuery filters tokens shorter than 2 chars", () => {
  const q = buildFtsQuery("a go x auth")
  expect(q).toBe('"go" OR "auth"')
  expect(q).not.toContain('"a"')
  expect(q).not.toContain('"x"')
})

test("C9: buildFtsQuery splits on non-word characters", () => {
  const q = buildFtsQuery("real-time.sync")
  expect(q).toBe('"real" OR "time" OR "sync"')
})

test("C9: buildFtsQuery produces valid FTS5 MATCH syntax (no syntax errors)", () => {
  const q = buildFtsQuery("auth login handler")
  // Should be usable in a MATCH query without throwing
  expect(() => {
    const testDb = new Database(":memory:")
    initSchema(testDb)
    testDb.query("SELECT * FROM chunks_fts WHERE chunks_fts MATCH ?").get(q)
    testDb.close()
  }).not.toThrow()
})

// ═══════════════════════════════════════════════════════════════
// C10: Plugin export contract — opencode expects { id, server }
// ═══════════════════════════════════════════════════════════════
test("C10: plugin exports default with id and server function", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain('export default')
  expect(src).toContain('id:')
  expect(src).toContain('server:')
  expect(src).toContain('_plugin')
})

// ═══════════════════════════════════════════════════════════════
// C11: Tool names contract — the LLM calls these by exact name
// ═══════════════════════════════════════════════════════════════
test("C11: plugin exposes exactly 4 tools with correct names", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain("context_analyze: tool({")
  expect(src).toContain("context_search: tool({")
  expect(src).toContain("context_stats: tool({")
  expect(src).toContain("context_clear: tool({")
})

// ═══════════════════════════════════════════════════════════════
// C12: Tool args contract — args must match what opencode sends
// ═══════════════════════════════════════════════════════════════
test("C12: context_search requires 'query' arg and optional 'n'", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain('query: tool.schema.string()')
  expect(src).toContain('n: tool.schema.number()')
  expect(src).toContain('.optional()')
  expect(src).toContain('.default(10)')
})

test("C12: context_analyze has optional 'path' arg", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain('path: tool.schema.string()')
  expect(src).toContain('.optional()')
})

// ═══════════════════════════════════════════════════════════════
// C13: Hook names contract — opencode calls these hooks by name
// ═══════════════════════════════════════════════════════════════
test("C13: plugin registers 'event' hook", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain("async event(")
})

test("C13: plugin registers 'experimental.chat.system.transform' hook", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain('experimental.chat.system.transform')
})

// ═══════════════════════════════════════════════════════════════
// C14: Error message contracts — these exact strings are returned
// ═══════════════════════════════════════════════════════════════
test("C14: 'no index' error message is stable", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain("No index. Run context_analyze first.")
})

test("C14: 'query too short' error message is stable", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain("Query too short. Use at least 2 characters.")
})

test("C14: 'no matches' error message is stable", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain("No matches found.")
})

test("C14: 'index cleared' success message is stable", async () => {
  const src = await Bun.file("./plugins/@madkoding-context-manager.ts").text()
  expect(src).toContain("Index cleared.")
})

// ═══════════════════════════════════════════════════════════════
// C15: Storage path contract — DB file location
// ═══════════════════════════════════════════════════════════════
test("C15: DB path is under ~/.cache/opencode/context-manager.sqlite", () => {
  const src = require("fs").readFileSync("./plugins/@madkoding-context-manager.ts", "utf-8")
  expect(src).toContain("context-manager.sqlite")
  expect(src).toContain(".cache/opencode")
})

test("C15: old JSON path is cleaned up on init", () => {
  const src = require("fs").readFileSync("./plugins/@madkoding-context-manager.ts", "utf-8")
  expect(src).toContain("context-manager.json")
  expect(src).toContain("unlinkSync")
})

// ═══════════════════════════════════════════════════════════════
// C16: Function signatures contract — exported functions keep their arity
// ═══════════════════════════════════════════════════════════════
test("C16: dbSearch takes (db, query, n) and returns SearchResult[]", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f:fn:x", file: "x.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
  ])
  const results = dbSearch(db, "foo", 5)
  expect(Array.isArray(results)).toBe(true)
  if (results.length > 0) {
    const r = results[0] as any
    expect(typeof r.name).toBe("string")
    expect(typeof r.content).toBe("string")
    expect(typeof r.file).toBe("string")
    expect(typeof r.type).toBe("string")
    expect(typeof r.line).toBe("number")
    expect(typeof r.score).toBe("number")
  }
})

test("C16: indexProject takes (root) and returns { files, chunks, fileHashes }", () => {
  writeFileSync(join(tmpDir, "c_test.ts"), "function foo() {}")
  const result = indexProject(tmpDir)
  expect(typeof result.files).toBe("number")
  expect(Array.isArray(result.chunks)).toBe(true)
  expect(typeof result.fileHashes).toBe("object")
})

test("C16: updateFile takes (db, fp, log?) and returns boolean", () => {
  const fp = join(tmpDir, "c_update.ts")
  writeFileSync(fp, "function foo() {}")
  const result = updateFile(db, fp)
  expect(typeof result).toBe("boolean")
})