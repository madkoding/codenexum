import { test, expect } from "bun:test"
import { compressToolOutput, getSemanticCompressionSaved } from "../src/compress"

test("compressToolOutput respects per-tool max lines", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")
  process.env.CONTEXT_MANAGER_TOOL_MAX_LINES_READ = "10"
  const compressed = compressToolOutput("read", output)
  expect(compressed).toContain("… (90 more lines omitted")
  delete process.env.CONTEXT_MANAGER_TOOL_MAX_LINES_READ
})

test("compressToolOutput falls back to general env var", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")
  process.env.CONTEXT_MANAGER_TOOL_MAX_LINES = "15"
  const compressed = compressToolOutput("bash", output)
  expect(compressed).toContain("… (85 more lines omitted")
  delete process.env.CONTEXT_MANAGER_TOOL_MAX_LINES
})

test("compressToolOutput semantically compresses test output", () => {
  const output = [
    "PASS src/a.test.ts",
    "PASS src/b.test.ts",
    "FAIL src/c.test.ts",
    "  ● should add numbers",
    "    Expected: 3",
    "    Received: 4",
    "",
    "Test Suites: 2 passed, 1 failed, 3 total",
    "Tests:       4 passed, 1 failed, 5 total",
  ].join("\n")
  const compressed = compressToolOutput("bash", output)
  expect(compressed).toContain("semantic compress")
  expect(compressed).toContain("4 passed")
  expect(compressed).toContain("1 failed")
})

test("compressToolOutput semantically compresses linter output", () => {
  const output = [
    "src/auth.ts:42:10 error Unexpected token",
    "src/auth.ts:45:5 warning Prefer const",
    "",
    "2 errors, 1 warning",
  ].join("\n")
  const compressed = compressToolOutput("bash", output)
  expect(compressed).toContain("semantic compress")
  expect(compressed).toContain("2 error")
})

test("getSemanticCompressionSaved returns chars saved only for semantic compression", () => {
  const original = "a".repeat(1000)
  const compressed = "[semantic compress] Tests: 5 passed"
  expect(getSemanticCompressionSaved(original, compressed)).toBeGreaterThan(0)
  expect(getSemanticCompressionSaved(original, original)).toBe(0)
})

test("compressToolOutput keeps short output untouched", () => {
  const output = "short output"
  expect(compressToolOutput("read", output)).toBe(output)
})
