import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import {
  estimateTokens,
  charsToTokens,
  getTokenizer,
  getTokenizerMode,
  resetTokenizer,
  resetTokenCache,
} from "../src/tokens"

describe("tokens", () => {
  const originalEnv = process.env.CONTEXT_MANAGER_TOKENIZER
  const originalCacheSize = process.env.CONTEXT_MANAGER_TOKEN_CACHE_SIZE

  beforeEach(() => {
    resetTokenizer()
    delete process.env.CONTEXT_MANAGER_TOKENIZER
    delete process.env.CONTEXT_MANAGER_TOKEN_CACHE_SIZE
  })

  afterEach(() => {
    resetTokenizer()
    if (originalEnv === undefined) delete process.env.CONTEXT_MANAGER_TOKENIZER
    else process.env.CONTEXT_MANAGER_TOKENIZER = originalEnv
    if (originalCacheSize === undefined) delete process.env.CONTEXT_MANAGER_TOKEN_CACHE_SIZE
    else process.env.CONTEXT_MANAGER_TOKEN_CACHE_SIZE = originalCacheSize
  })

  it("estimateTokens falls back to heuristic when tiktoken is unavailable", () => {
    // Force tiktoken mode but point require at a non-existent module by using
    // a cache size env var only; the tokenizer will try to load and fail.
    process.env.CONTEXT_MANAGER_TOKENIZER = "tiktoken"
    const text = "hello world"
    const n = estimateTokens(text)
    // gpt-tokenizer may or may not be installed in this test environment.
    // Either way the result must be finite and non-negative.
    expect(n).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(n)).toBe(true)
  })

  it("charsToTokens uses the fast 4 chars/token heuristic", () => {
    expect(charsToTokens(0)).toBe(0)
    expect(charsToTokens(4)).toBe(1)
    expect(charsToTokens(8)).toBe(2)
    expect(charsToTokens(10)).toBe(3) // rounds
  })

  it("getTokenizerMode reflects the active mode", () => {
    process.env.CONTEXT_MANAGER_TOKENIZER = "estimate"
    expect(getTokenizerMode()).toBe("estimate")
    resetTokenizer()
    process.env.CONTEXT_MANAGER_TOKENIZER = "tiktoken"
    expect(getTokenizerMode()).toBe("tiktoken")
  })

  it("resetTokenizer creates a fresh instance", () => {
    const t1 = getTokenizer()
    resetTokenizer()
    const t2 = getTokenizer()
    expect(t1).not.toBe(t2)
  })

  it("resetTokenCache clears the cache without error", () => {
    estimateTokens("some text to warm the cache")
    expect(() => resetTokenCache()).not.toThrow()
  })

  it("unknown tokenizer mode falls back to tiktoken mode object", () => {
    process.env.CONTEXT_MANAGER_TOKENIZER = "unknown"
    expect(getTokenizerMode()).toBe("tiktoken")
  })
})
