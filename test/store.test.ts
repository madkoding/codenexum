import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import {
  initSchema, dbInsertChunks, dbDeleteFile, dbGetFileHash, dbSetFileHash,
  dbGetMeta, dbSetMeta, dbChunkCount, dbFileCount, dbSearch, dbClear,
  dbStatsByLang, buildFtsQuery,
} from "../src/store"
import type { Chunk } from "../src/types"

let db: Database

beforeEach(() => {
  db = new Database(":memory:")
  initSchema(db)
})

afterEach(() => {
  db.close()
})

const sampleChunks: Chunk[] = [
  { id: "f1:fn:handleAuth", file: "src/auth.ts", name: "handleAuth", type: "function", line: 42, lineEnd: 45, content: "function handleAuth(req, res, next)", body: "function handleAuth(req, res, next) {\n  return next();\n}", lang: "typescript" },
  { id: "f2:fn:createInvoice", file: "src/billing.ts", name: "createInvoice", type: "function", line: 15, lineEnd: 18, content: "function createInvoice(items, tax)", body: "function createInvoice(items, tax) {\n  return items;\n}", lang: "typescript" },
  { id: "f3:cls:AuthMiddleware", file: "src/middleware.ts", name: "AuthMiddleware", type: "class", line: 5, lineEnd: 8, content: "class AuthMiddleware", body: "class AuthMiddleware {\n  use() {}\n}", lang: "typescript" },
  { id: "f4:type:DatabasePool", file: "src/db.ts", name: "DatabasePool", type: "type", line: 22, lineEnd: 22, content: "type DatabasePool", body: "type DatabasePool = {}", lang: "typescript" },
]

test("initSchema: creates tables", () => {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  expect(tables.map(t => t.name)).toContain("chunks_fts")
  expect(tables.map(t => t.name)).toContain("file_hashes")
  expect(tables.map(t => t.name)).toContain("meta")
})

test("dbInsertChunks + dbChunkCount", () => {
  expect(dbChunkCount(db)).toBe(0)
  dbInsertChunks(db, sampleChunks)
  expect(dbChunkCount(db)).toBe(4)
})

test("dbFileCount: counts unique files", () => {
  dbInsertChunks(db, sampleChunks)
  expect(dbFileCount(db)).toBe(4)
  // Add another chunk to same file
  dbInsertChunks(db, [{ id: "f1:fn:logout", file: "src/auth.ts", name: "logout", type: "function", line: 50, lineEnd: 52, content: "function logout()", body: "function logout() {}", lang: "typescript" }])
  expect(dbFileCount(db)).toBe(4) // still 4 unique files
  expect(dbChunkCount(db)).toBe(5)
})

test("dbDeleteFile: removes chunks and hash", () => {
  dbInsertChunks(db, sampleChunks)
  dbSetFileHash(db, "src/auth.ts", "hash123")
  expect(dbChunkCount(db)).toBe(4)
  dbDeleteFile(db, "src/auth.ts")
  expect(dbChunkCount(db)).toBe(3)
  expect(dbGetFileHash(db, "src/auth.ts")).toBeNull()
})

test("dbGetFileHash + dbSetFileHash", () => {
  dbSetFileHash(db, "src/test.ts", "abc123")
  expect(dbGetFileHash(db, "src/test.ts")).toBe("abc123")
  expect(dbGetFileHash(db, "src/none.ts")).toBeNull()
  // Update
  dbSetFileHash(db, "src/test.ts", "def456")
  expect(dbGetFileHash(db, "src/test.ts")).toBe("def456")
})

test("dbGetMeta + dbSetMeta", () => {
  dbSetMeta(db, "projectRoot", "/fake/project")
  expect(dbGetMeta(db, "projectRoot")).toBe("/fake/project")
  expect(dbGetMeta(db, "nonexistent")).toBeNull()
  // Update
  dbSetMeta(db, "projectRoot", "/other")
  expect(dbGetMeta(db, "projectRoot")).toBe("/other")
})

test("dbSearch: FTS5 finds exact match", () => {
  dbInsertChunks(db, sampleChunks)
  const results = dbSearch(db, "handleAuth", 10)
  expect(results.length).toBeGreaterThanOrEqual(1)
  expect(results[0].name).toBe("handleAuth")
})

test("dbSearch: trigram finds substrings", () => {
  dbInsertChunks(db, sampleChunks)
  // "invoice" should match "createInvoice" via trigram
  const results = dbSearch(db, "invoice", 10)
  expect(results.length).toBeGreaterThanOrEqual(1)
  expect(results.some(r => r.name === "createInvoice")).toBe(true)
})

test("dbSearch: multi-token query with OR", () => {
  dbInsertChunks(db, sampleChunks)
  const results = dbSearch(db, "auth database", 10)
  expect(results.length).toBeGreaterThanOrEqual(2)
  expect(results.some(r => r.name === "handleAuth" || r.name === "AuthMiddleware")).toBe(true)
  expect(results.some(r => r.name === "DatabasePool")).toBe(true)
})

test("dbSearch: returns empty for short query", () => {
  dbInsertChunks(db, sampleChunks)
  expect(dbSearch(db, "a", 10)).toHaveLength(0)
})

test("dbSearch: BM25 ranking orders by relevance", () => {
  dbInsertChunks(db, [
    { id: "a:fn:auth", file: "a.ts", name: "auth", type: "function", line: 1, lineEnd: 1, content: "auth", body: "auth", lang: "typescript" },
    { id: "b:fn:authHandler", file: "b.ts", name: "authHandler", type: "function", line: 1, lineEnd: 1, content: "function authHandler(req)", body: "function authHandler(req) {}", lang: "typescript" },
    { id: "c:fn:other", file: "c.ts", name: "other", type: "function", line: 1, lineEnd: 1, content: "function other(auth auth auth)", body: "function other(auth auth auth) {}", lang: "typescript" },
  ])
  const results = dbSearch(db, "auth", 10)
  expect(results.length).toBe(3)
  // All should match; BM25 scores should differ
  expect(results[0].score).not.toBe(results[1].score)
})

test("dbClear: wipes everything", () => {
  dbInsertChunks(db, sampleChunks)
  dbSetFileHash(db, "src/auth.ts", "hash")
  dbSetMeta(db, "projectRoot", "/fake")
  expect(dbChunkCount(db)).toBe(4)
  dbClear(db)
  expect(dbChunkCount(db)).toBe(0)
  expect(dbFileCount(db)).toBe(0)
  expect(dbGetMeta(db, "projectRoot")).toBeNull()
})

test("dbStatsByLang: groups by extension", () => {
  dbInsertChunks(db, sampleChunks)
  const stats = dbStatsByLang(db)
  expect(stats.length).toBeGreaterThanOrEqual(1)
  expect(stats.some(s => s.ext === ".ts")).toBe(true)
})

test("buildFtsQuery: single token", () => {
  expect(buildFtsQuery("auth")).toBe('"auth"')
})

test("buildFtsQuery: multi token joined with OR", () => {
  expect(buildFtsQuery("auth login handler")).toBe('"auth" OR "login" OR "handler"')
})

test("buildFtsQuery: filters short tokens", () => {
  expect(buildFtsQuery("a go auth")).toBe('"go" OR "auth"')
})

test("buildFtsQuery: splits on non-word chars", () => {
  expect(buildFtsQuery("real-time")).toBe('"real" OR "time"')
})