import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync, statSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { initSchema, dbInsertChunks } from "../src/store"
import { detectInterceptCandidate, tryInterceptOutput, getInterceptOptions } from "../src/intercept"
import type { Chunk } from "../src/types"

const chunks: Chunk[] = [
  { id: "1", name: "foo", file: "/tmp/a.ts", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() { return 1 }", lang: "ts" },
  { id: "2", name: "bar", file: "/tmp/a.ts", type: "function", line: 5, lineEnd: 7, content: "function bar()", body: "function bar() { return 2 }", lang: "ts" },
  { id: "3", name: "handleAuth", file: "/tmp/auth.ts", type: "function", line: 1, lineEnd: 3, content: "function handleAuth()", body: "function handleAuth(req) { return true }", lang: "ts" },
]

let tmpDir: string
let db: Database

function makeDb(root: string): Database {
  const d = new Database(":memory:")
  initSchema(d)
  const rootedChunks = chunks.map(c => ({ ...c, file: join(root, c.file.replace("/tmp/", "")) }))
  dbInsertChunks(d, rootedChunks)
  return d
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ctx-intercept-"))
  writeFileSync(join(tmpDir, "a.ts"), "function foo() { return 1 }\n\nfunction bar() { return 2 }\n")
  writeFileSync(join(tmpDir, "auth.ts"), "function handleAuth(req) { return true }\n")
  db = makeDb(tmpDir)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

test("detects read candidate for indexed project file", () => {
  const c = detectInterceptCandidate(db, tmpDir, "read", { filePath: join(tmpDir, "a.ts") })
  expect(c).toBeDefined()
  expect(c?.tool).toBe("read")
  expect(c?.resolvedPath).toBe(join(tmpDir, "a.ts"))
  expect(c?.substitutable).toBe(true)
})

test("does not detect read for file outside project root", () => {
  const c = detectInterceptCandidate(db, tmpDir, "read", { filePath: "/etc/passwd" })
  expect(c).toBeUndefined()
})

test("does not detect candidate when index is empty", () => {
  const empty = new Database(":memory:")
  initSchema(empty)
  const c = detectInterceptCandidate(empty, tmpDir, "read", { filePath: join(tmpDir, "a.ts") })
  expect(c).toBeUndefined()
  empty.close()
})

test("detects grep candidate", () => {
  const c = detectInterceptCandidate(db, tmpDir, "grep", { pattern: "handleAuth" })
  expect(c).toBeDefined()
  expect(c?.tool).toBe("grep")
  expect(c?.query).toBe("handleAuth")
})

test("detects glob candidate", () => {
  const c = detectInterceptCandidate(db, tmpDir, "glob", { pattern: "**/*.ts" })
  expect(c).toBeDefined()
  expect(c?.tool).toBe("glob")
  expect(c?.query).toBe("**/*.ts")
})

test("detects bash cat candidate", () => {
  const c = detectInterceptCandidate(db, tmpDir, "bash", { command: `cat "${join(tmpDir, "a.ts")}"` })
  expect(c).toBeDefined()
  expect(c?.tool).toBe("bash-read")
})

test("detects bash grep candidate", () => {
  const c = detectInterceptCandidate(db, tmpDir, "bash", { command: `rg "handleAuth" ${tmpDir}` })
  expect(c).toBeDefined()
  expect(c?.tool).toBe("bash-grep")
  expect(c?.query).toBe("handleAuth")
})

test("rejects complex bash commands", () => {
  const c = detectInterceptCandidate(db, tmpDir, "bash", { command: `cat ${join(tmpDir, "a.ts")} | grep foo` })
  expect(c).toBeUndefined()
})

test("tryInterceptOutput replaces read with index chunks", () => {
  const c = detectInterceptCandidate(db, tmpDir, "read", { filePath: join(tmpDir, "a.ts") })!
  const nativeOutput = "function foo() { return 1 }\n\nfunction bar() { return 2 }\n"
  const result = tryInterceptOutput(db, tmpDir, c, nativeOutput)
  expect(result.replaced).toBe(true)
  expect(result.output).toContain("// index: a.ts")
  expect(result.output).toContain("function foo()")
})

test("tryInterceptOutput respects offset/limit for reads", () => {
  const c = detectInterceptCandidate(db, tmpDir, "read", { filePath: join(tmpDir, "a.ts"), offset: 5, limit: 3 })!
  const nativeOutput = "function bar() { return 2 }\n"
  const result = tryInterceptOutput(db, tmpDir, c, nativeOutput)
  expect(result.replaced).toBe(true)
  expect(result.output).toContain("bar")
  expect(result.output).not.toContain("foo")
})

test("tryInterceptOutput replaces grep with search results", () => {
  const c = detectInterceptCandidate(db, tmpDir, "grep", { pattern: "handleAuth" })!
  const nativeOutput = "auth.ts:function handleAuth(req) { return true }\n".repeat(20)
  const result = tryInterceptOutput(db, tmpDir, c, nativeOutput)
  expect(result.replaced).toBe(true)
  expect(result.output).toContain("handleAuth")
  expect(result.tokensSaved).toBeGreaterThanOrEqual(0)
})

test("tryInterceptOutput replaces glob with file list", () => {
  const c = detectInterceptCandidate(db, tmpDir, "glob", { pattern: "**/*.ts" })!
  const nativeOutput = `${join(tmpDir, "a.ts")}\n${join(tmpDir, "auth.ts")}\n`
  const result = tryInterceptOutput(db, tmpDir, c, nativeOutput)
  expect(result.replaced).toBe(true)
  expect(result.output).toContain("a.ts")
  expect(result.output).toContain("auth.ts")
})

test("tryInterceptOutput does not replace when index has no match", () => {
  const c = detectInterceptCandidate(db, tmpDir, "grep", { pattern: "nonexistent" })!
  const result = tryInterceptOutput(db, tmpDir, c, "")
  expect(result.replaced).toBe(false)
})

test("mode off disables interception", () => {
  const c = detectInterceptCandidate(db, tmpDir, "read", { filePath: join(tmpDir, "a.ts") }, { mode: "off" })
  expect(c).toBeUndefined()
})

test("default options come from env", () => {
  const opts = getInterceptOptions()
  expect(opts.mode).toBe("substitute")
  expect(opts.interceptBash).toBe(true)
})
