import { test, expect, beforeEach } from "bun:test"
import { compactMessages, resetCompactionState } from "../src/compact"

beforeEach(() => {
  resetCompactionState()
})

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
  expect(compactMessages(msgs, 0.3).count).toBe(0)
})

test("compactMessages: compacts old tool outputs above threshold", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long, { path: "src/a.ts" })]),
    mkMsg([mkTool("bash", long, { command: "ls" })]),
    mkMsg([]),
    mkMsg([]),
  ]
  const result = compactMessages(msgs, 0.8)
  expect(result.count).toBe(2)
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
  const result = compactMessages(msgs, 0.9)
  expect(result.count).toBe(1)
  expect(msgs[1].parts[0].state.output).toBe(long)
})

test("compactMessages: skips already-compacted outputs on second call", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long)]),
    mkMsg([]),
    mkMsg([]),
  ]
  const first = compactMessages(msgs, 0.9)
  expect(first.count).toBe(1)
  // Second call with fresh copies of the same messages should not re-compact
  const msgs2 = [
    mkMsg([mkTool("read", long)]),
    mkMsg([]),
    mkMsg([]),
  ]
  const second = compactMessages(msgs2, 0.9)
  expect(second.count).toBe(0)
})

test("compactMessages: skips short outputs", () => {
  const short = "x".repeat(100)
  const msgs = [
    mkMsg([mkTool("read", short)]),
    mkMsg([]),
    mkMsg([]),
  ]
  expect(compactMessages(msgs, 0.9).count).toBe(0)
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

test("compactMessages: deduplicates identical tool outputs", () => {
  const long = "x".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long, { path: "src/a.ts" })]),
    mkMsg([mkTool("read", long, { path: "src/a.ts" })]),
    mkMsg([]),
    mkMsg([]),
  ]
  const result = compactMessages(msgs, 0.9)
  // First output gets compacted, second is a duplicate (same fingerprint) and also gets compacted with "duplicate" label
  expect(result.count).toBe(2)
  expect(msgs[0].parts[0].state.output).toContain("omitted")
  expect(msgs[1].parts[0].state.output).toContain("duplicate")
})

test("compactMessages: does not deduplicate different outputs", () => {
  const long1 = "x".repeat(2000)
  const long2 = "y".repeat(2000)
  const msgs = [
    mkMsg([mkTool("read", long1, { path: "src/a.ts" })]),
    mkMsg([mkTool("read", long2, { path: "src/b.ts" })]),
    mkMsg([]),
    mkMsg([]),
  ]
  const result = compactMessages(msgs, 0.9)
  expect(result.count).toBe(2)
  expect(msgs[0].parts[0].state.output).toContain("omitted")
  expect(msgs[1].parts[0].state.output).toContain("omitted")
  expect(msgs[1].parts[0].state.output).not.toContain("duplicate")
})