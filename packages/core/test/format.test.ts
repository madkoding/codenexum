import { test, expect } from "bun:test"
import { formatSearchResults, getDefaultSnippetLines, shouldGroupResults } from "../src/format"
import type { SearchResult } from "../src/types"

const results: SearchResult[] = [
  { name: "foo", content: "function foo()", body: "function foo() {\n  return 1\n}", file: "/tmp/a.ts", type: "function", line: 1, lineEnd: 3, lang: "ts", score: 0 },
  { name: "bar", content: "function bar()", body: "function bar() {\n  return 2\n}", file: "/tmp/a.ts", type: "function", line: 5, lineEnd: 7, lang: "ts", score: 0 },
  { name: "baz", content: "function baz()", body: "function baz() {\n  return 3\n}", file: "/tmp/b.ts", type: "function", line: 1, lineEnd: 3, lang: "ts", score: 0 },
]

test("getDefaultSnippetLines reads env var", () => {
  process.env.CODENEXUM_SNIPPET_LINES = "8"
  expect(getDefaultSnippetLines()).toBe(8)
  delete process.env.CODENEXUM_SNIPPET_LINES
})

test("getDefaultSnippetLines default is 12", () => {
  delete process.env.CODENEXUM_SNIPPET_LINES
  expect(getDefaultSnippetLines()).toBe(12)
})

test("shouldGroupResults returns true for 5+ results", () => {
  expect(shouldGroupResults(4)).toBe(false)
  expect(shouldGroupResults(5)).toBe(true)
})

test("formatSearchResults groups by file", () => {
  const out = formatSearchResults(results, "/tmp", { groupByFile: true, snippetLines: 12 })
  expect(out).toContain("a.ts")
  expect(out).toContain("b.ts")
  expect(out).toContain("function foo @ 1-3")
  expect(out).toContain("function bar @ 5-7")
})

test("formatSearchResults does not group when disabled", () => {
  const out = formatSearchResults(results.slice(0, 2), "/tmp", { groupByFile: false })
  expect(out).toContain("function foo @ a.ts:1-3")
  expect(out).toContain("function bar @ a.ts:5-7")
})
