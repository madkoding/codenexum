import { test, expect, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { startDashboard, stopDashboard } from "../src/dashboard"
import { initSchema, dbInsertChunks } from "../src/store"
import type { Chunk } from "../src/types"

const chunks: Chunk[] = [
  { id: "1", name: "foo", file: "/tmp/a.ts", type: "function", line: 1, lineEnd: 3, content: "function foo()", body: "function foo() { return 1 }", lang: "ts" },
  { id: "2", name: "bar", file: "/tmp/b.ts", type: "function", line: 1, lineEnd: 3, content: "function bar()", body: "function bar() { return 2 }", lang: "ts" },
]

function makeDb(): Database {
  const db = new Database(":memory:")
  initSchema(db)
  dbInsertChunks(db, chunks)
  return db
}

afterAll(() => {
  stopDashboard()
})

test("dashboard starts on localhost and returns html", async () => {
  const db = makeDb()
  const state = startDashboard(db)
  expect(state.ready).toBe(true)
  expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

  const res = await fetch(state.url)
  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain("Context Manager Dashboard")
  expect(html).toContain("Tokens saved")
  stopDashboard()
})

test("dashboard /api/stats returns expected keys", async () => {
  const db = makeDb()
  const state = startDashboard(db)
  const res = await fetch(`${state.url}/api/stats`)
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data.status).toBe("ready")
  expect(data.chunks).toBe(2)
  expect(data.files).toBe(2)
  expect(data.languages).toBeDefined()
  expect(data.estimatedSavings).toBe(0)
  stopDashboard()
})

test("dashboard bound to 127.0.0.1", async () => {
  const db = makeDb()
  const state = startDashboard(db)
  expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
  const res = await fetch(state.url)
  expect(res.status).toBe(200)
  stopDashboard()
})

test("dashboard /api/health", async () => {
  const db = makeDb()
  const state = startDashboard(db)
  const res = await fetch(`${state.url}/api/health`)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  stopDashboard()
})
