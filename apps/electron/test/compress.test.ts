import { test, expect } from "bun:test"
import { compressToolOutput, getSemanticCompressionSaved } from "../src/mcp/compress"

test("compressToolOutput respects per-tool max lines", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")
  process.env.CODENEXUM_MAX_LINES_READ = "10"
  const r = compressToolOutput("read", output)
  expect(r.output).toContain("90 lines omitted")
  delete process.env.CODENEXUM_MAX_LINES_READ
})

test("compressToolOutput falls back to default", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")
  const r = compressToolOutput("bash", output)
  expect(r.output).toContain("70 lines omitted")
})

test("compressToolOutput semantically compresses test output", () => {
  const output = [
    "PASS src/a.test.ts",
    "PASS src/b.test.ts",
    "FAIL src/c.test.ts > should work",
    "AssertionError: expected 1 to be 2",
    "    at line 42",
    "    at line 43",
    "Tests: 2 passed, 1 failed",
  ].join("\n")
  const r = compressToolOutput("test", output)
  expect(r.output).toContain("2 passed")
  expect(r.output).toContain("1 failed")
  expect(r.output).toContain("src/c.test.ts")
})

test("compressToolOutput returns empty for empty input", () => {
  const r = compressToolOutput("read", "")
  expect(r.output).toBe("")
})

test("compressToolOutput returns original if under limit", () => {
  const output = "short output"
  const r = compressToolOutput("read", output)
  expect(r.output).toBe(output)
})

test("getSemanticCompressionSaved returns 0 initially", () => {
  expect(getSemanticCompressionSaved()).toBe(0)
})
