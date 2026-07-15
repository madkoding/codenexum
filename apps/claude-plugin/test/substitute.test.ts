import { test, expect } from "bun:test"
import { extractCompressibleText, buildUpdatedResponse, substituteString, charsToTokens } from "../src/substitute"

// Real shapes captured from a live Claude Code session via `claude -d hooks`
// (see apps/claude-plugin/README.md) — not guesses.
const READ_RESPONSE = {
  type: "text",
  file: {
    filePath: "/repo/README.md",
    content: "# wub\n\nsome long content that goes on for a while\n",
    numLines: 3,
    startLine: 1,
    totalLines: 3,
  },
}

const BASH_RESPONSE = {
  stdout: " M infra/lib/publisher-stack.ts\n?? .claude/",
  stderr: "",
  interrupted: false,
  isImage: false,
  noOutputExpected: false,
}

test("extractCompressibleText pulls Read's file.content", () => {
  expect(extractCompressibleText("Read", READ_RESPONSE)).toBe(READ_RESPONSE.file.content)
})

test("extractCompressibleText pulls Bash's stdout", () => {
  expect(extractCompressibleText("Bash", BASH_RESPONSE)).toBe(BASH_RESPONSE.stdout)
})

test("extractCompressibleText returns null for Grep/Glob (no free-text field)", () => {
  expect(extractCompressibleText("Grep", { mode: "files_with_matches", filenames: ["a.ts"], numFiles: 1, totalFiles: 1 })).toBeNull()
})

test("extractCompressibleText returns null for a malformed Read response", () => {
  expect(extractCompressibleText("Read", { type: "text" })).toBeNull()
  expect(extractCompressibleText("Read", null)).toBeNull()
})

test("buildUpdatedResponse preserves Read's shape, swapping only content", () => {
  const updated = buildUpdatedResponse("Read", READ_RESPONSE, "[COMPRESSED]") as any
  expect(updated.type).toBe("text")
  expect(updated.file.filePath).toBe(READ_RESPONSE.file.filePath)
  expect(updated.file.content).toBe("[COMPRESSED]")
  expect(updated.file.numLines).toBe(1)
  expect(updated.file.totalLines).toBe(READ_RESPONSE.file.totalLines) // true file length, untouched
})

test("buildUpdatedResponse preserves Bash's shape, swapping only stdout", () => {
  const updated = buildUpdatedResponse("Bash", BASH_RESPONSE, "[COMPRESSED]") as any
  expect(updated.stdout).toBe("[COMPRESSED]")
  expect(updated.stderr).toBe("")
  expect(updated.interrupted).toBe(false)
})

test("buildUpdatedResponse returns null when the shape can't be reconstructed", () => {
  expect(buildUpdatedResponse("Read", { type: "text" }, "x")).toBeNull()
  expect(buildUpdatedResponse("Bash", null, "x")).toBeNull()
  expect(buildUpdatedResponse("Grep", { filenames: [] }, "x")).toBeNull()
})

test("substituteString truncates an oversized replacement to the original length", () => {
  expect(substituteString("short", "way too long replacement text")).toBe("way t")
})

test("substituteString passes through a replacement that already fits", () => {
  expect(substituteString("a long original string", "short")).toBe("short")
})

test("charsToTokens divides by 4 and rounds", () => {
  expect(charsToTokens(400)).toBe(100)
  expect(charsToTokens(10)).toBe(3)
})

test("charsToTokens floors negative/zero savings at 0", () => {
  expect(charsToTokens(0)).toBe(0)
  expect(charsToTokens(-50)).toBe(0)
})
