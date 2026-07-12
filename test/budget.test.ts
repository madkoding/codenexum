import { test, expect, beforeAll, beforeEach } from "bun:test"
import { setProjectContext, recordSearch, recordFileRead, recordNativeSearch, recordToolIntercept, recordSearchSavings, recordCompression, recordIndexSubstitution, recordIndexMiss, getUsage, measuredSavings, clearSession } from "../src/budget"
import { getRegistry, registerProject } from "../src/registry"
import { existsSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

const TEST_DIR = "/tmp/test-budget-project-cm"

beforeAll(() => {
  if (!existsSync(join(process.env.HOME || "/tmp", ".cache/opencode"))) {
    mkdirSync(join(process.env.HOME || "/tmp", ".cache/opencode"), { recursive: true })
  }
  registerProject(TEST_DIR)
  setProjectContext(TEST_DIR)
})

test("recordSearch: persists to registry", () => {
  recordSearch("s1", "test query", true)
  const u = getUsage("s1")
  expect(u.searchQueries).toBeGreaterThanOrEqual(1)
})

test("recordFileRead: persists to registry", () => {
  recordFileRead("s1")
  const u = getUsage("s1")
  expect(u.filesRead).toBeGreaterThanOrEqual(1)
})

test("measuredSavings: counts compression + search + index tokens", () => {
  const SPLIT_DIR = `/tmp/test-budget-real-cm-${Date.now()}`
  mkdirSync(SPLIT_DIR, { recursive: true })
  registerProject(SPLIT_DIR)
  setProjectContext(SPLIT_DIR)
  const projectId = "s2-real"
  clearSession(projectId)
  recordSearchSavings(projectId, 1000) // chars saved by snippet, stored as tokens
  recordCompression(projectId, 500) // chars saved by compression, stored as tokens
  recordIndexSubstitution(projectId, 100) // tokens saved by index substitution
  recordIndexMiss(projectId, "read", "file.ts")
  recordNativeSearch(projectId, "test query")
  recordToolIntercept(projectId, "bash", "ls -la")
  const u = getUsage(projectId)
  const measured = measuredSavings(u)
  expect(measured).toBe(475) // 250 search + 125 compression + 100 index tokens
  expect(u.compactions).toBe(0)
  expect(u.indexSubstitutions).toBeGreaterThanOrEqual(1)
  expect(u.indexMissed).toBeGreaterThanOrEqual(1)
  expect(u.indexSavedTokens).toBeGreaterThanOrEqual(100)
  // restore original test context
  setProjectContext(TEST_DIR)
})

test("getUsage: returns empty for unset project", () => {
  setProjectContext("/tmp/nonexistent-project-xyz")
  const u = getUsage("s3")
  expect(u.searchQueries || 0).toBe(0)
  setProjectContext(TEST_DIR)
})