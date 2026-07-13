import { test, expect } from "bun:test"
import { detectCandidate } from "../src/index"

const PROJECT = "/Users/test/project"
const SETTINGS = {
  readInterception: true,
  grepInterception: true,
  autoCompress: true,
  cache: true,
  turnSavingsLog: true,
  persistentCache: true,
  compressThreshold: 8000,
  cacheTtlMs: 300000,
  cacheMaxEntries: 200,
}

test("read with absolute path inside project returns candidate", () => {
  const c = detectCandidate("read", { filePath: "/Users/test/project/src/app.ts" }, PROJECT, SETTINGS)
  expect(c?.tool).toBe("read")
  expect(c?.path).toBe("/Users/test/project/src/app.ts")
})

test("read outside project returns null", () => {
  const c = detectCandidate("read", { filePath: "/etc/passwd" }, PROJECT, SETTINGS)
  expect(c).toBeNull()
})

test("grep with pattern returns candidate", () => {
  const c = detectCandidate("grep", { pattern: "TODO" }, PROJECT, SETTINGS)
  expect(c?.tool).toBe("grep")
  expect(c?.query).toBe("TODO")
})

test("webfetch with URL returns candidate", () => {
  const c = detectCandidate("webfetch", { url: "https://example.com/docs" }, PROJECT, SETTINGS)
  expect(c?.tool).toBe("webfetch")
  expect(c?.path).toBe("https://example.com/docs")
})

test("webfetch without URL returns null", () => {
  const c = detectCandidate("webfetch", {}, PROJECT, SETTINGS)
  expect(c).toBeNull()
})

test("websearch with query returns candidate", () => {
  const c = detectCandidate("websearch", { query: "opencode plugin api" }, PROJECT, SETTINGS)
  expect(c?.tool).toBe("websearch")
  expect(c?.query).toBe("opencode plugin api")
})

test("bash cat inside project returns bash-read candidate", () => {
  const c = detectCandidate("bash", { command: "cat src/app.ts" }, PROJECT, SETTINGS)
  expect(c?.tool).toBe("bash-read")
  expect(c?.path).toBe("/Users/test/project/src/app.ts")
})

test("bash git command returns null (not a file read)", () => {
  const c = detectCandidate("bash", { command: "git status" }, PROJECT, SETTINGS)
  expect(c).toBeNull()
})

test("unknown tool returns null", () => {
  const c = detectCandidate("custom_tool", {}, PROJECT, SETTINGS)
  expect(c).toBeNull()
})

test("readInterception=false disables read interception", () => {
  const s = { ...SETTINGS, readInterception: false }
  const c = detectCandidate("read", { filePath: "/Users/test/project/src/app.ts" }, PROJECT, s)
  expect(c).toBeNull()
})
