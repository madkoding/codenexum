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
    "Tests: 3 passed, 1 failed",
  ].join("\n")
  const compressed = compressToolOutput("bash", output, "npm test")
  expect(compressed).toContain("[semantic compress]")
  expect(compressed).toContain("Tests:")
})

test("compressToolOutput semantically compresses linter output", () => {
  const output = [
    "src/a.ts:12:3 error: unused variable 'x'",
    "src/b.ts:5:1 warning: missing return type",
    "Found 2 problems",
  ].join("\n")
  const compressed = compressToolOutput("bash", output, "npx eslint src/")
  expect(compressed).toContain("[semantic compress]")
  expect(compressed).toContain("Errors:")
})

test("compressToolOutput does NOT semantically compress non-runner bash output", () => {
  const output = [
    "PASS src/a.test.ts",
    "Tests: 3 passed, 1 failed",
  ].join("\n")
  const compressed = compressToolOutput("bash", output, "git log --oneline")
  expect(compressed).not.toContain("[semantic compress]")
})

test("compressToolOutput does NOT semantically compress read output", () => {
  const output = [
    "PASS src/a.test.ts",
    "Tests: 3 passed, 1 failed",
  ].join("\n")
  const compressed = compressToolOutput("read", output)
  expect(compressed).not.toContain("[semantic compress]")
})
