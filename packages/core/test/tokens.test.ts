import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import {
  estimateTokens,
  charsToTokens,
  getTokenizer,
  tokenizerMode,
  resetTokenizer,
  resetTokenCache,
} from "../src/tokens"

describe("tokens", () => {
  const originalEnv = process.env.CODENEXUM_TOKENIZER
  const originalCacheSize = process.env.CODENEXUM_TOKEN_CACHE_SIZE

  beforeEach(() => {
    resetTokenizer()
    delete process.env.CODENEXUM_TOKENIZER
    delete process.env.CODENEXUM_TOKEN_CACHE_SIZE
  })

  afterEach(() => {
    resetTokenizer()
    process.env.CODENEXUM_TOKENIZER = originalEnv
    process.env.CODENEXUM_TOKEN_CACHE_SIZE = originalCacheSize
  })

  it("estimateTokens returns ~chars/4 by default", () => {
    const text = "hello world this is a test"
    const est = estimateTokens(text)
    expect(est).toBeGreaterThan(0)
    expect(est).toBeLessThanOrEqual(text.length)
  })

  it("estimateTokens returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0)
  })

  it("charsToTokens converts char count to token estimate", () => {
    expect(charsToTokens(100)).toBe(25)
    expect(charsToTokens(0)).toBe(0)
  })

  it("getTokenizer returns a tokenizer", () => {
    const t = getTokenizer()
    expect(t).toBeDefined()
    expect(["tiktoken", "estimate"]).toContain(t.mode)
  })

  it("tokenizerMode returns current mode", () => {
    const mode = tokenizerMode()
    expect(["tiktoken", "estimate"]).toContain(mode)
  })

  it("resetTokenCache does not throw", () => {
    expect(() => resetTokenCache()).not.toThrow()
  })

  it("estimateTokens handles very long text", () => {
    const long = "word ".repeat(10000)
    const est = estimateTokens(long)
    expect(est).toBeGreaterThan(0)
  })

  it("estimateTokens handles unicode", () => {
    const text = "héllo wörld 🎉"
    const est = estimateTokens(text)
    expect(est).toBeGreaterThan(0)
  })
})
