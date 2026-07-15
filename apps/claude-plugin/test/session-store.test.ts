import { test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { recordEdit, wasEditedThisSession, cleanupOldSessions } from "../src/session-store"

const dir = mkdtempSync(join(tmpdir(), "codenexum-session-test-"))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test("a path not yet recorded is not considered edited", () => {
  expect(wasEditedThisSession("session-a", "/repo/src/app.ts", dir)).toBe(false)
})

test("recordEdit makes wasEditedThisSession true for that session", () => {
  recordEdit("session-b", "/repo/src/app.ts", dir)
  expect(wasEditedThisSession("session-b", "/repo/src/app.ts", dir)).toBe(true)
})

test("edits are isolated per session id", () => {
  recordEdit("session-c", "/repo/src/other.ts", dir)
  expect(wasEditedThisSession("session-d", "/repo/src/other.ts", dir)).toBe(false)
})

test("cleanupOldSessions does not throw on an empty/missing dir", () => {
  const emptyDir = join(dir, "does-not-exist-yet")
  expect(() => cleanupOldSessions(emptyDir)).not.toThrow()
})
