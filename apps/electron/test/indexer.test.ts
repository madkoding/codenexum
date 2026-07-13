import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createHash } from "crypto"
import { walk, parseFile, indexProject, updateFile } from "../src/mcp/indexer"
import { initSchema, dbInsertChunks, dbGetFileHash, dbChunkCount } from "../../../packages/sql/src/store"

let tmpDir: string
let db: Database

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ctx-test-"))
  db = new Database(":memory:")
  initSchema(db)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

test("hash returns consistent sha256", () => {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex")
  const h1 = hash("hello")
  const h2 = hash("hello")
  const h3 = hash("world")
  expect(h1).toBe(h2)
  expect(h1).not.toBe(h3)
  expect(h1.length).toBe(64)
})

test("walk finds files recursively", () => {
  mkdirSync(join(tmpDir, "sub"), { recursive: true })
  writeFileSync(join(tmpDir, "a.ts"), "function a() {}")
  writeFileSync(join(tmpDir, "sub", "b.ts"), "function b() {}")
  const files = walk(tmpDir, new Set())
  expect(files).toContain(join(tmpDir, "a.ts"))
  expect(files).toContain(join(tmpDir, "sub", "b.ts"))
})

test("walk ignores node_modules", () => {
  mkdirSync(join(tmpDir, "node_modules"), { recursive: true })
  writeFileSync(join(tmpDir, "node_modules", "lib.ts"), "function lib() {}")
  writeFileSync(join(tmpDir, "a.ts"), "function a() {}")
  const files = walk(tmpDir, new Set())
  expect(files).not.toContain(join(tmpDir, "node_modules", "lib.ts"))
  expect(files).toContain(join(tmpDir, "a.ts"))
})

test("parseFile returns chunks for a valid file", () => {
  writeFileSync(join(tmpDir, "test.ts"), "function hello() {\n  return 1\n}\n")
  const chunks = parseFile(join(tmpDir, "test.ts"))
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  expect(chunks[0].name).toBe("hello")
})

test("parseFile returns empty for unsupported extension", () => {
  writeFileSync(join(tmpDir, "test.xyz"), "some content")
  const chunks = parseFile(join(tmpDir, "test.xyz"))
  expect(chunks).toEqual([])
})

test("indexProject indexes files", () => {
  writeFileSync(join(tmpDir, "a.ts"), "function foo() {}\nfunction bar() {}")
  writeFileSync(join(tmpDir, "b.ts"), "function baz() {}")
  const result = indexProject(tmpDir)
  expect(result.chunks.length).toBe(3)
})

test("indexProject stores file hashes", () => {
  writeFileSync(join(tmpDir, "a.ts"), "function foo() {}")
  const result = indexProject(tmpDir)
  expect(Object.keys(result.fileHashes).length).toBeGreaterThanOrEqual(1)
})

test("updateFile updates a single file", () => {
  writeFileSync(join(tmpDir, "a.ts"), "function foo() {}")
  const result = indexProject(tmpDir)
  for (const c of result.chunks) dbInsertChunks(db, [c])
  writeFileSync(join(tmpDir, "a.ts"), "function foo() {}\nfunction bar() {}")
  updateFile(db, join(tmpDir, "a.ts"))
  expect(dbChunkCount(db)).toBe(2)
})
