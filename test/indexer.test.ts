import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { walk, parseFile, indexProject, updateFile, hash } from "../src/indexer"
import { initSchema, dbInsertChunks, dbGetFileHash, dbChunkCount } from "../src/store"

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

test("walk: finds code files", () => {
  writeFileSync(join(tmpDir, "test.ts"), "function foo() {}")
  writeFileSync(join(tmpDir, "test.py"), "def bar(): pass")
  writeFileSync(join(tmpDir, "readme.md"), "# readme")
  const files = walk(tmpDir, new Set())
  expect(files).toHaveLength(3)
  expect(files.some(f => f.endsWith("test.ts"))).toBe(true)
  expect(files.some(f => f.endsWith("test.py"))).toBe(true)
  expect(files.some(f => f.endsWith("readme.md"))).toBe(true)
})

test("walk: ignores node_modules and .git", () => {
  mkdirSync(join(tmpDir, "node_modules"))
  writeFileSync(join(tmpDir, "node_modules", "lib.ts"), "function lib() {}")
  mkdirSync(join(tmpDir, ".git"))
  writeFileSync(join(tmpDir, ".git", "config.ts"), "function git() {}")
  writeFileSync(join(tmpDir, "main.ts"), "function main() {}")
  const files = walk(tmpDir, new Set())
  expect(files).toHaveLength(1)
  expect(files[0]).toContain("main.ts")
})

test("walk: finds nested files", () => {
  mkdirSync(join(tmpDir, "src", "utils"), { recursive: true })
  writeFileSync(join(tmpDir, "src", "utils", "helper.ts"), "export const x = 1")
  writeFileSync(join(tmpDir, "src", "index.ts"), "function main() {}")
  const files = walk(tmpDir, new Set())
  expect(files).toHaveLength(2)
})

test("parseFile: returns chunks for known extension", () => {
  writeFileSync(join(tmpDir, "test.ts"), "function foo() {}")
  const chunks = parseFile(join(tmpDir, "test.ts"))
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  expect(chunks[0].name).toBe("foo")
})

test("parseFile: returns chunks for known extension with parser", () => {
  // .md now has a parser, test with a truly unknown extension
  writeFileSync(join(tmpDir, "test.unknown"), "some content")
  const chunks = parseFile(join(tmpDir, "test.unknown"))
  expect(chunks).toHaveLength(0)
})

test("parseFile: parses .md files", () => {
  writeFileSync(join(tmpDir, "test.md"), "# Hello")
  const chunks = parseFile(join(tmpDir, "test.md"))
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  expect(chunks[0].type).toBe("heading")
})

test("indexProject: indexes a directory", () => {
  writeFileSync(join(tmpDir, "auth.ts"), "function handleAuth(req) { return req }")
  writeFileSync(join(tmpDir, "model.py"), "class User:\n  pass")
  const { files, chunks, fileHashes } = indexProject(tmpDir)
  expect(files).toBe(2)
  expect(chunks.length).toBeGreaterThanOrEqual(2)
  expect(Object.keys(fileHashes)).toHaveLength(2)
  expect(chunks.some(c => c.name === "handleAuth")).toBe(true)
  expect(chunks.some(c => c.name === "User")).toBe(true)
})

test("indexProject: returns empty for non-existent dir", () => {
  const { files, chunks } = indexProject(join(tmpDir, "nonexistent"))
  expect(files).toBe(0)
  expect(chunks).toHaveLength(0)
})

test("indexProject: respects maxFiles cap and sets capped=true", () => {
  writeFileSync(join(tmpDir, "a.ts"), "function a() {}")
  writeFileSync(join(tmpDir, "b.ts"), "function b() {}")
  writeFileSync(join(tmpDir, "c.ts"), "function c() {}")
  const { files, capped } = indexProject(tmpDir, 2)
  expect(files).toBe(2)
  expect(capped).toBe(true)
})

test("indexProject: capped=false when under the cap", () => {
  writeFileSync(join(tmpDir, "a.ts"), "function a() {}")
  const { files, capped } = indexProject(tmpDir, 100)
  expect(files).toBe(1)
  expect(capped).toBe(false)
})

test("updateFile: inserts new file chunks", () => {
  const fp = join(tmpDir, "test.ts")
  writeFileSync(fp, "function foo() {}")
  const result = updateFile(db, fp)
  expect(result).toBe(true)
  expect(dbChunkCount(db)).toBe(1)
  expect(dbGetFileHash(db, fp)).not.toBeNull()
})

test("updateFile: skips unchanged file (hash match)", () => {
  const fp = join(tmpDir, "test.ts")
  writeFileSync(fp, "function foo() {}")
  updateFile(db, fp)
  const result = updateFile(db, fp)
  expect(result).toBe(false)
})

test("updateFile: updates changed file", () => {
  const fp = join(tmpDir, "test.ts")
  writeFileSync(fp, "function foo() {}")
  updateFile(db, fp)
  expect(dbChunkCount(db)).toBe(1)

  writeFileSync(fp, "function foo() {}\nfunction bar() {}")
  const result = updateFile(db, fp)
  expect(result).toBe(true)
  expect(dbChunkCount(db)).toBe(2)
})

test("updateFile: returns false for non-existent file", () => {
  const result = updateFile(db, join(tmpDir, "missing.ts"))
  expect(result).toBe(false)
})

test("updateFile: parses .md files", () => {
  const fp = join(tmpDir, "readme.md")
  writeFileSync(fp, "# Title")
  const result = updateFile(db, fp)
  expect(result).toBe(true)
  expect(dbChunkCount(db)).toBe(1)
})

test("hash: deterministic MD5", () => {
  expect(hash("hello")).toBe(hash("hello"))
  expect(hash("hello")).not.toBe(hash("world"))
  expect(hash("")).toHaveLength(32)
})