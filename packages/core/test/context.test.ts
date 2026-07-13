import { test, expect } from "bun:test"
import { ConversationContext } from "../src/context"

test("ConversationContext collects user terms", () => {
  process.env.CODENEXUM_SMART_READ = "1"
  const ctx = new ConversationContext()
  ctx.addUserText("how does the authenticate function work?")
  const terms = ctx.getTerms()
  expect(terms).toContain("authenticate")
  expect(terms).toContain("function")
  delete process.env.CODENEXUM_SMART_READ
})

test("ConversationContext is disabled by default", () => {
  delete process.env.CODENEXUM_SMART_READ
  const ctx = new ConversationContext()
  ctx.addUserText("how does login work")
  expect(ctx.getTerms()).toEqual([])
})

test("ConversationContext keeps only recent terms", () => {
  process.env.CODENEXUM_SMART_READ = "1"
  const ctx = new ConversationContext()
  ctx.addUserText("a b c d e f g h i j k l m n o p")
  const terms = ctx.getTerms()
  expect(terms.length).toBeLessThanOrEqual(10)
  delete process.env.CODENEXUM_SMART_READ
})
