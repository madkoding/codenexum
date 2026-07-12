import { test, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { initSchema, dbInsertChunks } from "../src/store"
import { formatSearchResults, getDefaultSnippetLines, shouldGroupResults } from "../src/format"
import type { Chunk } from "../src/types"

const chunks: Chunk[] = [
  { id: "1", name: "foo", file: "/tmp/a.ts", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() {\n  return 1\n}", lang: "ts" },
  { id: "2", name: "bar", file: "/tmp/a.ts", type: "function", line: 5, lineEnd: 7, content: "function bar()", body: "function bar() {\n  return 2\n}", lang: "ts" },
  { id: "3", name: "baz", file: "/tmp/b.ts", type: "function", line: 1, lineEnd: 3, content: "function baz()", body: "function baz() {\n  return 3\n}", lang: "ts" },
]

let db: Database

beforeEach(() => {
  db = new Database(":memory:")
  initSchema(db)
  dbInsertChunks(db, chunks)
})

test("getDefaultSnippetLines reads env var", () => {
  process.env.CONTEXT_MANAGER_SNIPPET_LINES = "8"
  expect(getDefaultSnippetLines()).toBe(8)
  delete process.env.CONTEXT_MANAGER_SNIPPET_LINES
})

test("getDefaultSnippetLines default is 12", () => {
  delete process.env.CONTEXT_MANAGER_SNIPPET_LINES
  expect(getDefaultSnippetLines()).toBe(12)
})

test("shouldGroupResults returns true for 5+ results", () => {
  expect(shouldGroupResults(4)).toBe(false)
  expect(shouldGroupResults(5)).toBe(true)
})

test("formatSearchResults groups by file", () => {
  const results = [
    { ...chunks[0], score: 0, file: "/tmp/a.ts" },
    { ...chunks[1], score: 0, file: "/tmp/a.ts" },
    { ...chunks[2], score: 0, file: "/tmp/b.ts" },
  ]
  const out = formatSearchResults(results, "/tmp", { groupByFile: true, snippetLines: 12 })
  expect(out).toContain("a.ts")
  expect(out).toContain("b.ts")
  expect(out).toContain("function foo @ 1-3")
  expect(out).toContain("function bar @ 5-7")
})

test("formatSearchResults does not group when disabled", () => {
  const results = [
    { ...chunks[0], score: 0, file: "/tmp/a.ts" },
    { ...chunks[1], score: 0, file: "/tmp/a.ts" },
  ]
  const out = formatSearchResults(results, "/tmp", { groupByFile: false })
  expect(out).toContain("function foo @ a.ts:1-3")
  expect(out).toContain("function bar @ a.ts:5-7")
})
