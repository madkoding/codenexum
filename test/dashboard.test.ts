import { test, expect, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { startDashboard, stopDashboard, registerProjectDb } from "../src/dashboard"
import { initSchema, dbInsertChunks } from "../src/store"
import { setProjectContext } from "../src/budget"
import { registerProject } from "../src/registry"
import type { Chunk } from "../src/types"

const chunks: Chunk[] = [
  { id: "1", name: "foo", file: "/tmp/a.ts", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() { return 1 }", lang: "ts" },
  { id: "2", name: "bar", file: "/tmp/b.ts", type: "function", line: 1, lineEnd: 3, content: "function bar()", body: "function bar() { return 2 }", lang: "ts" },
]

const TEST_DIR = "/tmp/test-project-cm"

function makeDb(): Database {
  const db = new Database(":memory:")
  initSchema(db)
  dbInsertChunks(db, chunks)
  return db
}

function getProjId(): string {
  const { projectId } = require("../src/registry")
  return projectId(TEST_DIR)
}

afterAll(() => {
  stopDashboard()
})

test("dashboard starts on localhost and returns health", async () => {
  const db = makeDb()
  const id = getProjId()
  registerProjectDb(id, db)
  registerProject(TEST_DIR)
  setProjectContext(TEST_DIR)
  const state = await startDashboard(db)
  expect(state.ready).toBe(true)
  expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

  const res = await fetch(`${state.url}/api/health`)
  expect(res.status).toBe(200)
  const health = await res.json()
  expect(health.ok).toBe(true)
  stopDashboard()
})

test("dashboard /api/health", async () => {
  const db = makeDb()
  const id = getProjId()
  registerProjectDb(id, db)
  registerProject(TEST_DIR)
  const state = await startDashboard(db)
  const res = await fetch(`${state.url}/api/health`)
  expect(res.status).toBe(200)
  const health = await res.json()
  expect(health.ok).toBe(true)
  stopDashboard()
})

test("dashboard /api/projects returns project list", async () => {
  const db = makeDb()
  const id = getProjId()
  registerProjectDb(id, db)
  registerProject(TEST_DIR)
  const state = await startDashboard(db)
  const res = await fetch(`${state.url}/api/projects`)
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(Array.isArray(data)).toBe(true)
  stopDashboard()
})

test("dashboard /api/aggregate returns global stats", async () => {
  const db = makeDb()
  const id = getProjId()
  registerProjectDb(id, db)
  registerProject(TEST_DIR)
  const state = await startDashboard(db)
  const res = await fetch(`${state.url}/api/aggregate`)
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data).toHaveProperty("timeline")
  expect(data).toHaveProperty("toolDistribution")
  stopDashboard()
})

test("dashboard /api/project/:id/stats returns stats", async () => {
  const db = makeDb()
  const id = getProjId()
  registerProjectDb(id, db)
  registerProject(TEST_DIR)
  const state = await startDashboard(db)
  const res = await fetch(`${state.url}/api/project/${id}/stats`)
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data.status).toBe("ready")
  expect(data.chunks).toBe(2)
  stopDashboard()
})

test("dashboard /api/project/:id/search returns results", async () => {
  const db = makeDb()
  const id = getProjId()
  registerProjectDb(id, db)
  registerProject(TEST_DIR)
  const state = await startDashboard(db)
  const res = await fetch(`${state.url}/api/project/${id}/search?q=foo&n=5`)
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data.results).toBeDefined()
  expect(data.results.length).toBeGreaterThan(0)
  expect(data.results[0].name).toBe("foo")
  stopDashboard()
})