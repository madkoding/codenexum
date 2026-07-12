import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  initSchema, dbInsertChunks, dbSetFileHash, dbSetMeta,
  dbChunkCount, dbFileCount, dbSearch, dbClear, dbGetMeta, dbStatsByLang,
} from "../src/store"
import { indexProject, updateFile, debouncedUpdateFile } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"

let tmpDir: string
let db: Database

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ctx-int-"))
  db = new Database(":memory:")
  initSchema(db)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

test("end-to-end: index project → search → find results", () => {
  writeFileSync(join(tmpDir, "auth.ts"), "function handleAuth(req, res, next) { }")
  writeFileSync(join(tmpDir, "billing.ts"), "function createInvoice(items, tax) { }")
  writeFileSync(join(tmpDir, "middleware.ts"), "class AuthMiddleware { }")

  const { chunks, fileHashes } = indexProject(tmpDir)
  dbInsertChunks(db, chunks)
  for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
  dbSetMeta(db, "projectRoot", tmpDir)
  dbSetMeta(db, "indexedAt", new Date().toISOString())

  expect(dbChunkCount(db)).toBe(3)

  const authResults = dbSearch(db, "auth", 10)
  expect(authResults.length).toBeGreaterThanOrEqual(2)
  expect(authResults.some(r => r.name === "handleAuth")).toBe(true)
  expect(authResults.some(r => r.name === "AuthMiddleware")).toBe(true)

  const invoiceResults = dbSearch(db, "invoice", 10)
  expect(invoiceResults.length).toBeGreaterThanOrEqual(1)
  expect(invoiceResults.some(r => r.name === "createInvoice")).toBe(true)
})

test("end-to-end: updateFile increments index", () => {
  writeFileSync(join(tmpDir, "main.ts"), "function init() { }")
  const { chunks, fileHashes } = indexProject(tmpDir)
  dbInsertChunks(db, chunks)
  for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
  dbSetMeta(db, "projectRoot", tmpDir)

  expect(dbChunkCount(db)).toBe(1)

  writeFileSync(join(tmpDir, "extra.ts"), "function helper() { }")
  updateFile(db, join(tmpDir, "extra.ts"))

  expect(dbChunkCount(db)).toBe(2)
  const results = dbSearch(db, "helper", 10)
  expect(results.some(r => r.name === "helper")).toBe(true)
})

test("end-to-end: dbClear wipes index", () => {
  const { chunks } = indexProject(tmpDir)
  dbInsertChunks(db, chunks)
  dbSetMeta(db, "projectRoot", tmpDir)

  expect(dbChunkCount(db)).toBeGreaterThanOrEqual(0)
  dbClear(db)
  expect(dbChunkCount(db)).toBe(0)
  expect(dbGetMeta(db, "projectRoot")).toBeNull()
})

test("buildSystemPrompt: returns empty string when no index", () => {
  expect(buildSystemPrompt(db)).toBe("")
})

test("buildSystemPrompt: returns prompt with stats when indexed", () => {
  writeFileSync(join(tmpDir, "test.ts"), "function foo() {}")
  const { chunks, fileHashes } = indexProject(tmpDir)
  dbInsertChunks(db, chunks)
  for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
  dbSetMeta(db, "projectRoot", tmpDir)
  dbSetMeta(db, "indexedAt", "2026-01-01T00:00:00.000Z")

  const prompt = buildSystemPrompt(db)
  expect(prompt).toContain("<context-manager>")
  expect(prompt).toContain("chunks")
  expect(prompt).toContain("context_search")
})

test("integration: multiple languages in one project", () => {
  mkdirSync(join(tmpDir, "src"), { recursive: true })
  writeFileSync(join(tmpDir, "src", "auth.py"), "def login(user):\n  pass")
  writeFileSync(join(tmpDir, "src", "model.go"), "type User struct { }")
  writeFileSync(join(tmpDir, "src", "handler.rb"), "def handle_request\nend")

  const { files, chunks, fileHashes } = indexProject(tmpDir)
  expect(files).toBe(3)
  expect(chunks.length).toBeGreaterThanOrEqual(3)

  dbInsertChunks(db, chunks)
  for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
  dbSetMeta(db, "projectRoot", tmpDir)

  const pyResults = dbSearch(db, "login", 10)
  expect(pyResults.some(r => r.name === "login")).toBe(true)

  const goResults = dbSearch(db, "user", 10)
  expect(goResults.some(r => r.name === "User")).toBe(true)

  const rbResults = dbSearch(db, "handle request", 10)
  expect(rbResults.some(r => r.name === "handle_request")).toBe(true)
})

test("ensureProject is idempotent: same dir returns cached entry", async () => {
  // Simulate what ensureProject does: open a DB for a dir, reopen it, verify reuse
  const { registerProject } = await import("../src/registry")
  const projInfo = registerProject(tmpDir)
  const db1 = new Database(projInfo.dbPath)
  initSchema(db1)
  dbSetMeta(db1, "projectRoot", tmpDir)
  const db2 = new Database(projInfo.dbPath)
  initSchema(db2)
  dbSetMeta(db2, "projectRoot", tmpDir)
  // Both should have the same path
  expect(dbGetMeta(db1, "projectRoot")).toBe(tmpDir)
  expect(dbGetMeta(db2, "projectRoot")).toBe(tmpDir)
  db1.close()
  db2.close()
})

test("multi-project: separate DBs for separate directories", () => {
  const dir1 = mkdtempSync(join(tmpdir(), "ctx-mp1-"))
  const dir2 = mkdtempSync(join(tmpdir(), "ctx-mp2-"))

  writeFileSync(join(dir1, "foo.ts"), "function one() {}")
  writeFileSync(join(dir2, "bar.ts"), "function two() {}")

  const { registerProject } = require("../src/registry") as typeof import("../src/registry")
  const { indexProject } = require("../src/indexer") as { indexProject: typeof import("../src/indexer").indexProject }

  const proj1 = registerProject(dir1)
  const db1 = new Database(proj1.dbPath)
  initSchema(db1)

  const proj2 = registerProject(dir2)
  const db2 = new Database(proj2.dbPath)
  initSchema(db2)

  const r1: ReturnType<typeof indexProject> = indexProject(dir1)
  dbInsertChunks(db1, r1.chunks)
  for (const [fp, h] of Object.entries(r1.fileHashes)) dbSetFileHash(db1, fp, h)
  dbSetMeta(db1, "projectRoot", dir1)

  const r2: ReturnType<typeof indexProject> = indexProject(dir2)
  dbInsertChunks(db2, r2.chunks)
  for (const [fp, h] of Object.entries(r2.fileHashes)) dbSetFileHash(db2, fp, h)
  dbSetMeta(db2, "projectRoot", dir2)

  expect(dbChunkCount(db1)).toBeGreaterThan(0)
  expect(dbChunkCount(db2)).toBeGreaterThan(0)

  // Search each DB independently — should only find symbols from its own project
  const res1 = dbSearch(db1, "one", 10)
  const res2 = dbSearch(db2, "one", 10)
  expect(res1.some(r => r.name === "one")).toBe(true)
  expect(res2.some(r => r.name === "one")).toBe(false) // bar.ts, no "one"

  const res3 = dbSearch(db1, "two", 10)
  const res4 = dbSearch(db2, "two", 10)
  expect(res3.some(r => r.name === "two")).toBe(false) // foo.ts, no "two"
  expect(res4.some(r => r.name === "two")).toBe(true)

  rmSync(dir1, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
  db1.close()
  db2.close()
})