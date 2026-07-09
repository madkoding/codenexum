import { test, expect } from "bun:test"
import { compressToolOutput } from "../src/compress"

test("compressToolOutput: leaves short output untouched", () => {
  const out = "line1\nline2\nline3"
  expect(compressToolOutput("read", out)).toBe(out)
})

test("compressToolOutput: truncates long read output", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`)
  const out = lines.join("\n")
  const res = compressToolOutput("read", out)
  expect(res).toContain("more lines omitted")
  expect(res.split("\n").length).toBeLessThan(lines.length)
  expect(res.split("\n").length).toBeLessThanOrEqual(201)
})

test("compressToolOutput: ignores non-target tools", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`)
  const out = lines.join("\n")
  expect(compressToolOutput("write", out)).toBe(out)
})

test("compressToolOutput: respects env override", () => {
  const prev = process.env.CONTEXT_MANAGER_TOOL_MAX_LINES
  process.env.CONTEXT_MANAGER_TOOL_MAX_LINES = "10"
  const lines = Array.from({ length: 50 }, (_, i) => `x${i}`)
  const out = lines.join("\n")
  const res = compressToolOutput("bash", out)
  expect(res).toContain("more lines omitted")
  process.env.CONTEXT_MANAGER_TOOL_MAX_LINES = prev
})