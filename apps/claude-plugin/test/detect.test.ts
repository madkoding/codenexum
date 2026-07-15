import { test, expect } from "bun:test"
import { detectCandidate } from "../src/detect"

const CWD = "/Users/test/project"

test("Read with a normal file path returns a read candidate", () => {
  const c = detectCandidate("Read", { file_path: "/Users/test/project/src/app.ts" }, CWD)
  expect(c?.kind).toBe("read")
  expect(c?.path).toBe("/Users/test/project/src/app.ts")
})

test("Read on a denylisted path returns null", () => {
  const c = detectCandidate("Read", { file_path: "/Users/test/project/.env" }, CWD)
  expect(c).toBeNull()
})

test("Read without file_path returns null", () => {
  const c = detectCandidate("Read", {}, CWD)
  expect(c).toBeNull()
})

// Grep/Glob substitution was dropped: their native tool_response is a
// structured { filenames, numFiles, totalFiles } object with no free-text
// field, so CodeNexum's formatted search-index string can never be
// substituted in without either violating Claude Code's output-shape
// validation or fabricating filenames/counts. See detect.ts for the full
// explanation (found via live validation, not by inspection).
test("Grep never returns a candidate (no safe output shape to substitute into)", () => {
  const c = detectCandidate("Grep", { pattern: "TODO" }, CWD)
  expect(c).toBeNull()
})

test("Glob never returns a candidate (no safe output shape to substitute into)", () => {
  const c = detectCandidate("Glob", { pattern: "**/*.ts" }, CWD)
  expect(c).toBeNull()
})

test("Bash cat on a normal file returns a read candidate", () => {
  const c = detectCandidate("Bash", { command: "cat src/app.ts" }, CWD)
  expect(c?.kind).toBe("read")
  expect(c?.path).toBe("/Users/test/project/src/app.ts")
})

test("Bash cat on a denylisted file returns null", () => {
  const c = detectCandidate("Bash", { command: "cat .aws/credentials" }, CWD)
  expect(c).toBeNull()
})

test("Bash git command returns a compress candidate", () => {
  const c = detectCandidate("Bash", { command: "git diff" }, CWD)
  expect(c?.kind).toBe("compress")
  expect(c?.toolID).toBe("git")
})

test("Bash npm test returns a compress candidate", () => {
  const c = detectCandidate("Bash", { command: "npm test" }, CWD)
  expect(c?.kind).toBe("compress")
  expect(c?.toolID).toBe("npm")
})

test("Bash curl is NOT compressible (dropped from the port on purpose)", () => {
  const c = detectCandidate("Bash", { command: "curl https://example.com" }, CWD)
  expect(c).toBeNull()
})

test("Bash ssh/scp/wget are NOT compressible (dropped from the port on purpose)", () => {
  expect(detectCandidate("Bash", { command: "ssh host" }, CWD)).toBeNull()
  expect(detectCandidate("Bash", { command: "scp file host:" }, CWD)).toBeNull()
  expect(detectCandidate("Bash", { command: "wget https://example.com" }, CWD)).toBeNull()
})

test("Bash with an unrecognized command returns null", () => {
  const c = detectCandidate("Bash", { command: "echo hi" }, CWD)
  expect(c).toBeNull()
})

test("unknown tool returns null", () => {
  const c = detectCandidate("SomeOtherTool", {}, CWD)
  expect(c).toBeNull()
})

test("no cwd returns null", () => {
  const c = detectCandidate("Read", { file_path: "/Users/test/project/src/app.ts" }, "")
  expect(c).toBeNull()
})
