import { test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { initSchema, dbInsertChunks, dbInsertEdges, dbFindRelated, dbFindImpacted, dbEdgeCount } from "../src/store"
import { extractEdges } from "../src/edges"
import type { Chunk } from "../src/types"

let db: Database

beforeEach(() => {
  db = new Database(":memory:")
  initSchema(db)
})

afterEach(() => {
  db.close()
})

test("extractEdges: function calls another function", () => {
  const chunks: Chunk[] = [
    { id: "a:fn:foo", file: "a.ts", name: "foo", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() { bar() }", lang: "ts" },
    { id: "b:fn:bar", file: "b.ts", name: "bar", type: "function", line: 1, lineEnd: 3, content: "function bar()", body: "function bar() { return 1 }", lang: "ts" },
  ]
  const edges = extractEdges(chunks)
  expect(edges.length).toBeGreaterThanOrEqual(1)
  const fooToBar = edges.find(e => e.sourceSymbol === "foo" && e.targetSymbol === "bar")
  expect(fooToBar).toBeDefined()
})

test("dbInsertEdges and dbEdgeCount", () => {
  dbInsertEdges(db, [
    { sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "b.ts", targetSymbol: "bar", kind: "call" },
    { sourceFile: "b.ts", sourceSymbol: "Derived", targetFile: "a.ts", targetSymbol: "Base", kind: "extend" },
  ])
  expect(dbEdgeCount(db)).toBe(2)
})

test("dbFindRelated returns related chunks", () => {
  dbInsertChunks(db, [
    { id: "a:fn:foo", file: "a.ts", name: "foo", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() { bar() }", lang: "ts" },
    { id: "b:fn:bar", file: "b.ts", name: "bar", type: "function", line: 1, lineEnd: 3, content: "function bar()", body: "function bar() { return 1 }", lang: "ts" },
  ])
  dbInsertEdges(db, [{ sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "b.ts", targetSymbol: "bar", kind: "call" }])
  const related = dbFindRelated(db, "a.ts", "foo")
  expect(related.length).toBeGreaterThanOrEqual(1)
  expect(related[0].symbol).toBe("bar")
})

test("dbFindImpacted returns impacted chunks", () => {
  dbInsertChunks(db, [
    { id: "a:fn:foo", file: "a.ts", name: "foo", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() { bar() }", lang: "ts" },
    { id: "b:fn:bar", file: "b.ts", name: "bar", type: "function", line: 1, lineEnd: 3, content: "function bar()", body: "function bar() { return 1 }", lang: "ts" },
  ])
  dbInsertEdges(db, [{ sourceFile: "a.ts", sourceSymbol: "foo", targetFile: "b.ts", targetSymbol: "bar", kind: "call" }])
  const impacted = dbFindImpacted(db, ["b.ts"])
  expect(impacted.length).toBeGreaterThanOrEqual(1)
  expect(impacted[0].dependent).toBe("a.ts")
})
