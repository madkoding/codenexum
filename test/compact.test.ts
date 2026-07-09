import { test, expect } from "bun:test"
import { compactMessages } from "../src/compact"

function mkMsg(parts: any[]): { info: { role: string }; parts: any[] } {
  return { info: { role: "assistant" }, parts }
}

function mkTool(tool: string, output: string, input?: Record<string, unknown>): any {
  return { type: "tool", tool, state: { status: "completed", output, input, time: { start: 0, end: 1 } } }
}

test("compactMessages: no compaction under threshold", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long)]),
    mkMsg([]),
    mkMsg([]),
  ]
  expect(compactMessages(msgs, 0.3)).toBe(0)
})

test("compactMessages: compacts old tool outputs above threshold", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long, { path: "src/a.ts" })]),
    mkMsg([mkTool("bash", long, { command: "ls" })]),
    mkMsg([]),
    mkMsg([]),
  ]
  const n = compactMessages(msgs, 0.8)
  expect(n).toBe(2)
  expect(msgs[0].parts[0].state.output).toContain("read")
  expect(msgs[0].parts[0].state.output).toContain("omitted")
  expect(msgs[1].parts[0].state.output).toContain("ls")
})

test("compactMessages: keeps recent turns untouched", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long)]),
    mkMsg([mkTool("read", long)]),
    mkMsg([]),
  ]
  const n = compactMessages(msgs, 0.9)
  expect(n).toBe(1)
  expect(msgs[1].parts[0].state.output).toBe(long)
})

test("compactMessages: skips already-compacted", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([{ type: "tool", tool: "read", state: { status: "completed", output: long, time: { start: 0, end: 1, compacted: 123 } } }]),
    mkMsg([]),
    mkMsg([]),
  ]
  expect(compactMessages(msgs, 0.9)).toBe(0)
})

test("compactMessages: skips short outputs", () => {
  const short = "x".repeat(100)
  const msgs = [
    mkMsg([mkTool("read", short)]),
    mkMsg([]),
    mkMsg([]),
  ]
  expect(compactMessages(msgs, 0.9)).toBe(0)
})

test("compactMessages: marks compacted time", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long)]),
    mkMsg([]),
    mkMsg([]),
  ]
  compactMessages(msgs, 0.9)
  expect(msgs[0].parts[0].state.time.compacted).toBeGreaterThan(0)
})