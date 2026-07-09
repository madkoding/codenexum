import { test, expect, beforeEach } from "bun:test"
import { recordTokens, getUsage, getFillRatio, clearSession } from "../src/budget"

beforeEach(() => {
  clearSession("s1")
  clearSession("s2")
})

test("recordTokens: accumulates per session", () => {
  recordTokens("s1", 100, 50)
  recordTokens("s1", 200, 60)
  const u = getUsage("s1")
  expect(u.input).toBe(200)
  expect(u.output).toBe(60)
})

test("recordTokens: sessions are independent", () => {
  recordTokens("s1", 100, 50)
  recordTokens("s2", 999, 1)
  expect(getUsage("s1").input).toBe(100)
  expect(getUsage("s2").input).toBe(999)
})

test("recordTokens: ignores undefined sessionID", () => {
  recordTokens(undefined, 100, 50)
  expect(getUsage(undefined).input).toBe(0)
})

test("getFillRatio: returns 0 for unknown session", () => {
  expect(getFillRatio("nope")).toBe(0)
})

test("getFillRatio: uses default limit when none provided", () => {
  recordTokens("s1", 50000, 0)
  const r = getFillRatio("s1", 100000)
  expect(r).toBe(0.5)
})

test("getFillRatio: falls back to env default", () => {
  recordTokens("s1", 1000, 0)
  const r = getFillRatio("s1")
  expect(r).toBeGreaterThan(0)
  expect(r).toBeLessThan(1)
})

test("clearSession: resets usage", () => {
  recordTokens("s1", 100, 50)
  clearSession("s1")
  expect(getUsage("s1").input).toBe(0)
})