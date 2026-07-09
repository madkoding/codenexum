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