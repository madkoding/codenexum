import { test, expect } from "bun:test"
import { ConversationContext } from "../src/context"

test("ConversationContext collects user terms", () => {
  process.env.CONTEXT_MANAGER_SMART_READ = "1"
  const ctx = new ConversationContext()
  ctx.addUserText("how does the authenticate function work?")
  const terms = ctx.getTerms()
  expect(terms).toContain("authenticate")
  expect(terms).toContain("function")
  delete process.env.CONTEXT_MANAGER_SMART_READ
})

test("ConversationContext is disabled by default", () => {
  delete process.env.CONTEXT_MANAGER_SMART_READ
  const ctx = new ConversationContext()
  ctx.addUserText("how does login work")
  expect(ctx.getTerms()).toEqual([])
})

test("ConversationContext keeps only recent terms", () => {
  process.env.CONTEXT_MANAGER_SMART_READ = "1"
  const ctx = new ConversationContext(5)
  ctx.addUserText("one two three four five six")
  const terms = ctx.getTerms()
  expect(terms.length).toBeLessThanOrEqual(5)
  delete process.env.CONTEXT_MANAGER_SMART_READ
})
