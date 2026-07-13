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
  { id: "f1:fn:validateToken", file: "src/auth.ts", name: "validateToken", type: "function", line: 50, lineEnd: 55, content: "function validateToken(token)", body: "function validateToken(token) {\n  return token === 'valid';\n}", lang: "typescript" },
  { id: "f2:class:UserService", file: "src/services/user.ts", name: "UserService", type: "class", line: 1, lineEnd: 20, content: "class UserService", body: "class UserService {\n  async getUsers() {}\n}", lang: "typescript" },
  { id: "f3:fn:parseConfig", file: "src/config.ts", name: "parseConfig", type: "function", line: 10, lineEnd: 15, content: "function parseConfig(raw)", body: "function parseConfig(raw) {\n  return JSON.parse(raw);\n}", lang: "typescript" },
]

test("initSchema creates tables", () => {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' OR type='virtual' ORDER BY name").all() as { name: string }[]
  const names = tables.map(t => t.name)
  expect(names).toContain("chunks_fts")
  expect(names).toContain("file_hashes")
  expect(names).toContain("meta")
  expect(names).toContain("edges")
})

test("dbInsertChunks inserts and dbChunkCount returns count", () => {
  dbInsertChunks(db, sampleChunks)
  expect(dbChunkCount(db)).toBe(4)
})

test("dbInsertChunks inserts duplicate chunks", () => {
  dbInsertChunks(db, [sampleChunks[0]])
  dbInsertChunks(db, [sampleChunks[0]])
  expect(dbChunkCount(db)).toBe(2)
})

test("dbDeleteFile removes chunks for a file", () => {
  dbInsertChunks(db, sampleChunks)
  dbDeleteFile(db, "src/auth.ts")
  expect(dbChunkCount(db)).toBe(2)
})

test("dbGetFileHash / dbSetFileHash round-trip", () => {
  dbSetFileHash(db, "src/auth.ts", "abc123")
  expect(dbGetFileHash(db, "src/auth.ts")).toBe("abc123")
  expect(dbGetFileHash(db, "nonexistent.ts")).toBeNull()
})

test("dbGetMeta / dbSetMeta round-trip", () => {
  dbSetMeta(db, "indexedAt", "2024-01-01")
  expect(dbGetMeta(db, "indexedAt")).toBe("2024-01-01")
  expect(dbGetMeta(db, "missing")).toBeNull()
})

test("dbFileCount returns unique file count", () => {
  dbInsertChunks(db, sampleChunks)
  expect(dbFileCount(db)).toBe(3)
})

test("dbSearch finds chunks by FTS", () => {
  dbInsertChunks(db, sampleChunks)
  const results = dbSearch(db, "handleAuth", 10)
  expect(results.length).toBeGreaterThanOrEqual(1)
  expect(results[0].name).toBe("handleAuth")
})

test("dbSearch returns empty for no match", () => {
  dbInsertChunks(db, sampleChunks)
  expect(dbSearch(db, "zzz_nonexistent", 10)).toEqual([])
})

test("dbClear wipes all data", () => {
  dbInsertChunks(db, sampleChunks)
  dbClear(db)
  expect(dbChunkCount(db)).toBe(0)
  expect(dbFileCount(db)).toBe(0)
})

test("dbStatsByLang returns language breakdown", () => {
  dbInsertChunks(db, sampleChunks)
  const stats = dbStatsByLang(db)
  expect(stats.length).toBeGreaterThanOrEqual(1)
  const ts = stats.find(s => s.ext === ".ts")
  expect(ts).toBeDefined()
  expect(ts!.n).toBe(4)
})

test("buildFtsQuery escapes special characters", () => {
  const q = buildFtsQuery("hello.world")
  expect(q).not.toContain(".")
})

test("buildFtsQuery handles multi-word queries", () => {
  const q = buildFtsQuery("auth function")
  expect(q).toContain("auth")
  expect(q).toContain("function")
})
