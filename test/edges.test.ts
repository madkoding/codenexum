import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { initSchema, dbInsertChunks, dbInsertEdges, dbFindRelated, dbFindImpacted, dbEdgeCount } from "../src/store"
import { extractEdges } from "../src/edges"
import { indexProject } from "../src/indexer"
import type { Chunk } from "../src/types"

let tmpDir: string
let db: Database

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ctx-edge-test-"))
  db = new Database(":memory:")
  initSchema(db)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

function chunk(c: Partial<Chunk> & { file: string; name: string; type: Chunk["type"]; line: number }): Chunk {
  return {
    id: `${c.file}:${c.type}:${c.name}`,
    lineEnd: c.line,
    content: c.content ?? `${c.type} ${c.name}`,
    body: c.body ?? `${c.type} ${c.name} {}`,
    lang: c.lang ?? "typescript",
    ...c,
  } as Chunk
}

test("extractEdges: links local import to target file", () => {
  const chunks: Chunk[] = [
    chunk({ file: join(tmpDir, "src", "a.ts"), name: "foo", type: "function", line: 1 }),
    chunk({ file: join(tmpDir, "src", "b.ts"), name: "bar", type: "function", line: 1 }),
    chunk({ file: join(tmpDir, "src", "a.ts"), name: "utils", type: "import", line: 1, content: `import { bar } from "./b"`, body: `import { bar } from "./b"` }),
  ]
  const edges = extractEdges(chunks)
  expect(edges.some(e => e.kind === "import" && e.targetFile.includes("b.ts"))).toBe(true)
})

test("extractEdges: links function call across files", () => {
  const chunks: Chunk[] = [
    chunk({ file: join(tmpDir, "src", "auth.ts"), name: "authenticate", type: "function", line: 1, body: "function authenticate() { return true; }" }),
    chunk({ file: join(tmpDir, "src", "login.ts"), name: "login", type: "function", line: 1, body: "function login() { return authenticate(); }" }),
  ]
  const edges = extractEdges(chunks)
  expect(edges.some(e => e.kind === "call" && e.targetSymbol === "authenticate")).toBe(true)
})

test("extractEdges: links class extends", () => {
  const chunks: Chunk[] = [
    chunk({ file: join(tmpDir, "src", "base.ts"), name: "BaseController", type: "class", line: 1 }),
    chunk({ file: join(tmpDir, "src", "auth.ts"), name: "AuthController", type: "class", line: 1, body: "class AuthController extends BaseController {}" }),
  ]
  const edges = extractEdges(chunks)
  expect(edges.some(e => e.kind === "extend" && e.targetSymbol === "BaseController")).toBe(true)
})

test("dbInsertEdges + dbEdgeCount", () => {
  dbInsertEdges(db, [
    { sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "b.ts", targetSymbol: "bar", kind: "call" },
    { sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "c.ts", targetSymbol: "baz", kind: "import" },
  ])
  expect(dbEdgeCount(db)).toBe(2)
})

test("dbFindRelated: out and in directions", () => {
  dbInsertEdges(db, [
    { sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "b.ts", targetSymbol: "bar", kind: "call" },
    { sourceFile: "c.ts", sourceSymbol: "baz", targetFile: "a.ts", targetSymbol: "foo", kind: "call" },
  ])
  const related = dbFindRelated(db, "a.ts", "foo")
  expect(related.length).toBe(2)
  expect(related.some(r => r.direction === "out" && r.symbol === "bar")).toBe(true)
  expect(related.some(r => r.direction === "in" && r.symbol === "baz")).toBe(true)
})

test("dbFindImpacted: dependents of a file", () => {
  dbInsertEdges(db, [
    { sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "b.ts", targetSymbol: "bar", kind: "import" },
    { sourceFile: "c.ts", sourceSymbol: "baz", targetFile: "b.ts", targetSymbol: "bar", kind: "call" },
  ])
  const impacted = dbFindImpacted(db, ["b.ts"])
  expect(impacted.length).toBe(2)
  expect(impacted.some(r => r.dependent === "a.ts")).toBe(true)
  expect(impacted.some(r => r.dependent === "c.ts")).toBe(true)
})

test("indexProject: extracts edges for real files", () => {
  const auth = join(tmpDir, "auth.ts")
  const login = join(tmpDir, "login.ts")
  writeFileSync(auth, "export function authenticate() { return true; }")
  writeFileSync(login, "import { authenticate } from \"./auth\";\nfunction login() { return authenticate(); }\n")
  const { chunks, edges } = indexProject(tmpDir)
  expect(chunks.length).toBeGreaterThanOrEqual(2)
  expect(edges.length).toBeGreaterThanOrEqual(1)
  expect(edges.some(e => e.kind === "call" && e.targetSymbol === "authenticate")).toBe(true)
})
