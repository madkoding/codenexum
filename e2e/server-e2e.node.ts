import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const tmpDir = mkdtempSync(join(tmpdir(), "codenexum-mcp-e2e-"))
const testProjectDir = join(tmpDir, "test-project")
const testProjectFile = join(testProjectDir, "store.ts")
mkdirSync(testProjectDir, { recursive: true })
writeFileSync(testProjectFile, `export function hello(name: string) { return "hi " + name }
export const value = 42
export class MyClass { greet() { return "hello" } }
`)
writeFileSync(join(testProjectDir, "package.json"), '{"name": "test"}')
writeFileSync(join(testProjectDir, "other.ts"), `export function other() { return 1 }`)

process.env.CODENEXUM_USER_DATA = tmpDir

const BUNDLE = process.env.CODENEXUM_TEST_BUNDLE || "/tmp/codenexum-server-bundle.js"
const mod = await import(pathToFileURL(BUNDLE).href)
const port = 20000 + Math.floor(Math.random() * 5000)
const serverInstance = await mod.startMcpServer(port)
const baseUrl = `http://127.0.0.1:${serverInstance.port}`

async function rpc(tool: string, args: any = {}) {
  const r = await fetch(`${baseUrl}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  })
  const raw = await r.text()
  let data: any = null
  try { data = JSON.parse(raw) } catch {}
  return { status: r.status, data }
}

test("server is healthy", async () => {
  const r = await fetch(`${baseUrl}/health`)
  await r.text()
  assert.equal(r.status, 200)
  const r2 = await fetch(`${baseUrl}/health`)
  const data = await r2.json()
  assert.equal(data.status, "ok")
})

test("/api/settings returns defaults", async () => {
  const r = await fetch(`${baseUrl}/api/settings`)
  const data = await r.json()
  assert.equal(data.readInterception, true)
  assert.equal(data.compressThreshold, 8000)
})

test("404 for unknown route", async () => {
  const r = await fetch(`${baseUrl}/does-not-exist`)
  await r.text()
  assert.equal(r.status, 404)
})

test("cm_projects_list returns array initially", async () => {
  const { data } = await rpc("cm_projects_list", {})
  assert.ok(Array.isArray(data.result))
})

test("cm_analyze indexes project", async () => {
  const { data } = await rpc("cm_analyze", { path: testProjectDir })
  assert.equal(data.result.ok, true)
  assert.ok(data.result.files > 0)
  assert.ok(data.result.chunks > 0)
})

test("cm_projects_list returns the indexed project", async () => {
  const { data } = await rpc("cm_projects_list", {})
  const projects = data.result
  assert.ok(projects.length > 0)
  const ours = projects.find((p: any) => p.path === testProjectDir)
  assert.ok(ours)
  assert.ok(ours.chunks > 0)
})

test("cm_search finds indexed symbols", async () => {
  const { data } = await rpc("cm_search", { path: testProjectDir, query: "hello", n: 5 })
  const names = (data.result as any[]).map((r: any) => r.name)
  assert.ok(names.includes("hello"))
})

test("cm_search with n=0 clamps to 10", async () => {
  const { data } = await rpc("cm_search", { path: testProjectDir, query: "export", n: 0 })
  assert.ok((data.result as any[]).length <= 10)
})

test("cm_search with n=-1 clamps to 10", async () => {
  const { data } = await rpc("cm_search", { path: testProjectDir, query: "export", n: -1 })
  assert.ok((data.result as any[]).length <= 10)
})

test("cm_search with n=99999 clamps to 200", async () => {
  const { data } = await rpc("cm_search", { path: testProjectDir, query: "export", n: 99999 })
  assert.ok((data.result as any[]).length <= 200)
})

test("cm_search returns reason for empty query", async () => {
  const { data } = await rpc("cm_search", { path: testProjectDir, query: "" })
  assert.equal(data.reason, "empty or too-short query")
})

test("cm_search returns reason for non-indexed path", async () => {
  const fakePath = join(tmpDir, "non-existent-project")
  mkdirSync(fakePath, { recursive: true })
  const { data } = await rpc("cm_search", { path: fakePath, query: "unicornio" })
  assert.equal(data.reason, "project not indexed — run cm_analyze")
})

test("cm_search with type: filter", async () => {
  const { data } = await rpc("cm_search", { path: testProjectDir, query: "type:function", n: 10 })
  const results = data.result as any[]
  assert.ok(results.length > 0)
  for (const r of results) assert.equal(r.type, "function")
})

test("cm_read_snippet returns chunks for a file", async () => {
  const { data } = await rpc("cm_read_snippet", { path: testProjectDir, filePath: testProjectFile })
  assert.ok(typeof data.result === "string")
  assert.ok(data.result.length > 0)
  assert.ok(data.result.includes("hello"))
})

test("cm_read_snippet returns null for non-indexed file", async () => {
  const { data } = await rpc("cm_read_snippet", { path: testProjectDir, filePath: "/nonexistent.ts" })
  assert.equal(data.result, null)
})

test("cm_search_snippet returns formatted output", async () => {
  const { data } = await rpc("cm_search_snippet", { path: testProjectDir, query: "hello" })
  assert.ok(typeof data.result === "string")
  assert.ok((data.result as string).includes("// index search:"))
})

test("cm_search_snippet with fileFilter restricts", async () => {
  const { data } = await rpc("cm_search_snippet", { path: testProjectDir, query: "hello", fileFilter: "store.ts" })
  assert.ok(typeof data.result === "string")
  assert.ok((data.result as string).includes("store.ts"))
})

test("cm_stats returns index info", async () => {
  const { data } = await rpc("cm_stats", { path: testProjectDir })
  assert.ok(data.result.chunks > 0)
  assert.ok(data.result.files > 0)
  assert.ok(Array.isArray(data.result.languages))
})

test("cm_aggregate returns byType, byLang, topFiles", async () => {
  const { data } = await rpc("cm_aggregate", { path: testProjectDir })
  assert.ok(data.result.byType)
  assert.ok(data.result.byLang)
  assert.ok(Array.isArray(data.result.topFiles))
})

test("cm_analytics returns global analytics (default week)", async () => {
  const { data } = await rpc("cm_analytics", {})
  assert.ok(data.result.activityTimeline)
  assert.equal(data.result.activityTimeline.length, 7)
  assert.equal(data.result.period, "week")
  assert.equal(data.result.granularity, "day")
  assert.ok(data.result.recentActivity)
  assert.ok(data.result.indexHealth)
  assert.ok(data.result.globalTotals)
})

test("cm_analytics day period returns 24 hourly buckets with byMechanism", async () => {
  const { data } = await rpc("cm_analytics", { period: "day" })
  assert.equal(data.result.activityTimeline.length, 24)
  assert.equal(data.result.granularity, "hour")
  const bucket = data.result.activityTimeline[0]
  assert.ok(bucket.byMechanism)
  assert.equal(typeof bucket.byMechanism.indexSubstitution, "number")
  assert.equal(typeof bucket.byMechanism.searchSnippets, "number")
  assert.equal(typeof bucket.byMechanism.compression, "number")
})

test("cm_analytics month period returns 30 daily buckets", async () => {
  const { data } = await rpc("cm_analytics", { period: "month" })
  assert.equal(data.result.activityTimeline.length, 30)
  assert.equal(data.result.granularity, "day")
})

test("cm_analytics year period returns 12 monthly buckets", async () => {
  const { data } = await rpc("cm_analytics", { period: "year" })
  assert.equal(data.result.activityTimeline.length, 12)
  assert.equal(data.result.granularity, "month")
})

test("cm_dashboard returns state", async () => {
  const { data } = await rpc("cm_dashboard", {})
  assert.ok(Array.isArray(data.result.projects))
  assert.ok(data.result.global)
  assert.ok(data.result.compression)
})

test("cm_compression returns status", async () => {
  const { data } = await rpc("cm_compression", {})
  assert.equal(data.result.active, true)
  assert.ok(data.result.modes.includes("semantic"))
})

test("cm_compress_output compresses large output", async () => {
  const big = "x".repeat(20000)
  const { data } = await rpc("cm_compress_output", { toolID: "read", output: big })
  assert.ok((data.result as string).length < big.length)
})

test("cm_compress_output returns original for small output", async () => {
  const { data } = await rpc("cm_compress_output", { toolID: "read", output: "small" })
  assert.equal(data.result, "small")
})

test("cm_compress_output semantic summarizes test results", async () => {
  const testOutput = `
PASS src/foo.test.ts
FAIL src/baz.test.ts
  TypeError: cannot read property x of undefined
Tests: 1 passed, 1 failed
`
  const { data } = await rpc("cm_compress_output", { toolID: "bash", output: testOutput, semantic: true })
  assert.ok((data.result as string).includes("passed"))
  assert.ok((data.result as string).includes("failed"))
})

test("cm_log_event logs", async () => {
  const { data } = await rpc("cm_log_event", {
    projectDir: testProjectDir,
    eventType: "test_event",
    tokensSaved: 100,
  })
  assert.equal(data.result, true)
})

test("cm_cache_get/put roundtrip", async () => {
  await rpc("cm_cache_put", { key: "test-key", output: "cached-value" })
  const { data } = await rpc("cm_cache_get", { key: "test-key" })
  assert.equal(data.result, "cached-value")
})

test("cm_cache_get returns null for missing", async () => {
  const { data } = await rpc("cm_cache_get", { key: "no-such-key" })
  assert.equal(data.result, null)
})

test("cm_settings_get returns settings", async () => {
  const { data } = await rpc("cm_settings_get", {})
  assert.equal(typeof data.result, "object")
  assert.equal(typeof data.result.compressThreshold, "number")
})

test("cm_settings_set updates and persists", async () => {
  const { data } = await rpc("cm_settings_set", { settings: { compressThreshold: 9999 } })
  assert.equal(data.result.compressThreshold, 9999)
  const { data: data2 } = await rpc("cm_settings_get", {})
  assert.equal(data2.result.compressThreshold, 9999)
  await rpc("cm_settings_set", { settings: { compressThreshold: 8000 } })
})

test("cm_projects_get returns project by id", async () => {
  const { data: list } = await rpc("cm_projects_list", {})
  const proj = list.result.find((p: any) => p.path === testProjectDir)
  assert.ok(proj)
  const { data } = await rpc("cm_projects_get", { id: proj.id })
  assert.equal(data.result.id, proj.id)
})

test("cm_projects_get error for missing id", async () => {
  const { data } = await rpc("cm_projects_get", { id: "non-existent" })
  assert.equal(data.error, "project not found")
})

test("cm_projects_update renames", async () => {
  const { data: list } = await rpc("cm_projects_list", {})
  const proj = list.result.find((p: any) => p.path === testProjectDir)
  const { data } = await rpc("cm_projects_update", { id: proj.id, name: "renamed-test" })
  assert.equal(data.result.ok, true)
  const { data: list2 } = await rpc("cm_projects_list", {})
  const renamed = list2.result.find((p: any) => p.id === proj.id)
  assert.equal(renamed.name, "renamed-test")
})

test("cm_projects_delete removes project", async () => {
  const tmpProj = join(tmpDir, "delete-test")
  mkdirSync(tmpProj, { recursive: true })
  writeFileSync(join(tmpProj, "a.ts"), "export const x = 1")
  writeFileSync(join(tmpProj, "package.json"), "{}")
  await rpc("cm_analyze", { path: tmpProj })
  const { data: list } = await rpc("cm_projects_list", {})
  const proj = list.result.find((p: any) => p.path === tmpProj)
  assert.ok(proj)
  const { data } = await rpc("cm_projects_delete", { id: proj.id })
  assert.equal(data.result.ok, true)
  const { data: list2 } = await rpc("cm_projects_list", {})
  assert.equal(list2.result.find((p: any) => p.path === tmpProj), undefined)
})

test("POST /tools/call without tool returns 400", async () => {
  const r = await fetch(`${baseUrl}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args: {} }),
  })
  await r.text()
  assert.equal(r.status, 400)
})

test("POST /tools/call with invalid JSON returns 400", async () => {
  const r = await fetch(`${baseUrl}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  })
  await r.text()
  assert.equal(r.status, 400)
})

test("cm_analyze on empty path returns error", async () => {
  const { data } = await rpc("cm_analyze", { path: "" })
  assert.equal(data.error, "missing path")
})

test("cleanup", () => {
  serverInstance.close()
  rmSync(tmpDir, { recursive: true, force: true })
  assert.ok(true)
})
