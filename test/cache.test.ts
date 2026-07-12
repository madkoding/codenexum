import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { ToolOutputCache } from "../src/cache"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

let tmpDir: string

function makeDb(): Database {
  return new Database(":memory:")
}

test("ToolOutputCache returns cached entry", () => {
  const cache = new ToolOutputCache()
  cache.set("read", { filePath: "src/a.ts" }, "cached output", "hash1")
  const entry = cache.get("read", { filePath: "src/a.ts" }, "hash1")
  expect(entry).toBeDefined()
  expect(entry?.output).toBe("cached output")
})

test("ToolOutputCache invalidates on hash mismatch", () => {
  const cache = new ToolOutputCache()
  cache.set("read", { filePath: "src/a.ts" }, "cached output", "hash1")
  const entry = cache.get("read", { filePath: "src/a.ts" }, "hash2")
  expect(entry).toBeUndefined()
})

test("ToolOutputCache respects TTL", async () => {
  const cache = new ToolOutputCache(50, 1)
  cache.set("read", { filePath: "src/a.ts" }, "cached output")
  expect(cache.get("read", { filePath: "src/a.ts" })).toBeDefined()
  await Bun.sleep(10)
  expect(cache.get("read", { filePath: "src/a.ts" })).toBeUndefined()
})

test("ToolOutputCache disabled by env var", () => {
  process.env.CONTEXT_MANAGER_CACHE_TOOLS = "0"
  const cache = new ToolOutputCache()
  cache.set("read", { filePath: "src/a.ts" }, "cached output")
  const entry = cache.get("read", { filePath: "src/a.ts" })
  expect(entry).toBeUndefined()
  delete process.env.CONTEXT_MANAGER_CACHE_TOOLS
})
