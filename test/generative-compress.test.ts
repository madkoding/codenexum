import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import {
  getGenerativeCompressionOptions,
  shouldCompressGenerativeOutput,
  compressGenerativeOutput,
  tryDecompressGenerativeOutput,
  wrapCompressedOutput,
  stripCompressionMarkers,
  buildGenerativeCompressionInstruction,
  getCompressOutputOptions,
  shouldCompressOutputMessage,
  compressMessage,
} from "../src/generative-compress"

describe("generative compression", () => {
  const originalCompress = process.env.CONTEXT_MANAGER_COMPRESS_WRITES
  const originalThreshold = process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD

  beforeEach(() => {
    delete process.env.CONTEXT_MANAGER_COMPRESS_WRITES
    delete process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD
  })

  afterEach(() => {
    if (originalCompress === undefined) delete process.env.CONTEXT_MANAGER_COMPRESS_WRITES
    else process.env.CONTEXT_MANAGER_COMPRESS_WRITES = originalCompress
    if (originalThreshold === undefined) delete process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD
    else process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD = originalThreshold
  })

  it("getGenerativeCompressionOptions defaults to disabled with 1000 threshold", () => {
    expect(getGenerativeCompressionOptions()).toEqual({ enabled: false, threshold: 1000 })
  })

  it("getGenerativeCompressionOptions reads env variables", () => {
    process.env.CONTEXT_MANAGER_COMPRESS_WRITES = "1"
    process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD = "500"
    expect(getGenerativeCompressionOptions()).toEqual({ enabled: true, threshold: 500 })
  })

  it("getGenerativeCompressionOptions clamps invalid thresholds to 1000", () => {
    process.env.CONTEXT_MANAGER_COMPRESS_WRITES = "1"
    process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD = "abc"
    expect(getGenerativeCompressionOptions()).toEqual({ enabled: true, threshold: 1000 })
  })

  it("shouldCompressGenerativeOutput returns false when disabled", () => {
    expect(shouldCompressGenerativeOutput("x".repeat(2000))).toBe(false)
  })

  it("shouldCompressGenerativeOutput returns true above threshold when enabled", () => {
    process.env.CONTEXT_MANAGER_COMPRESS_WRITES = "1"
    expect(shouldCompressGenerativeOutput("x".repeat(999))).toBe(false)
    expect(shouldCompressGenerativeOutput("x".repeat(1000))).toBe(true)
  })

  it("compressGenerativeOutput round-trips through gzip+base64", () => {
    const text = "Hello, generative compression!\n".repeat(50)
    const { base64, originalChars } = compressGenerativeOutput(text)
    expect(originalChars).toBe(text.length)
    expect(base64.length).toBeLessThan(text.length)
    const result = tryDecompressGenerativeOutput(wrapCompressedOutput("src/foo.ts", base64))
    expect(result).toBeDefined()
    expect(result!.content).toBe(text)
    expect(result!.filePath).toBe("src/foo.ts")
  })

  it("tryDecompressGenerativeOutput returns undefined for plain text", () => {
    expect(tryDecompressGenerativeOutput("plain text")).toBeUndefined()
  })

  it("tryDecompressGenerativeOutput returns undefined for invalid base64", () => {
    const bad = "--- compressed:foo.txt ---\nnot-base64\n--- end compressed ---"
    expect(tryDecompressGenerativeOutput(bad)).toBeUndefined()
  })

  it("stripCompressionMarkers removes markers from text", () => {
    const wrapped = "--- compressed:foo.txt ---\nabc123\n--- end compressed ---"
    expect(stripCompressionMarkers(wrapped)).toBe("abc123")
  })

  it("buildGenerativeCompressionInstruction includes threshold and format", () => {
    const instruction = buildGenerativeCompressionInstruction(1500)
    expect(instruction).toContain("1500")
    expect(instruction).toContain("--- compressed")
    expect(instruction).toContain("--- end compressed ---")
  })
})

describe("output compression", () => {
  const originalEnabled = process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT
  const originalThreshold = process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD

  beforeEach(() => {
    delete process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT
    delete process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD
  })

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT
    else process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT = originalEnabled
    if (originalThreshold === undefined) delete process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD
    else process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD = originalThreshold
  })

  it("getCompressOutputOptions defaults to disabled with 500 threshold", () => {
    expect(getCompressOutputOptions()).toEqual({ enabled: false, threshold: 500 })
  })

  it("getCompressOutputOptions reads env variables", () => {
    process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT = "1"
    process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD = "300"
    expect(getCompressOutputOptions()).toEqual({ enabled: true, threshold: 300 })
  })

  it("shouldCompressOutputMessage returns false when disabled", () => {
    expect(shouldCompressOutputMessage("x".repeat(1000))).toBe(false)
  })

  it("shouldCompressOutputMessage returns true above threshold when enabled", () => {
    process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT = "1"
    expect(shouldCompressOutputMessage("x".repeat(499))).toBe(false)
    expect(shouldCompressOutputMessage("x".repeat(500))).toBe(true)
  })

  it("compressMessage wraps with role marker and round-trips", () => {
    const text = "Hello output compression world\n".repeat(30)
    const { wrapped, originalChars, compressedChars } = compressMessage(text, "assistant")
    expect(wrapped).toContain("--- compressed:assistant ---")
    expect(wrapped).toContain("--- end compressed ---")
    expect(originalChars).toBe(text.length)
    expect(compressedChars).toBeLessThan(originalChars)
    const decompressed = tryDecompressGenerativeOutput(wrapped)
    expect(decompressed).toBeDefined()
    expect(decompressed!.content).toBe(text)
    expect(decompressed!.filePath).toBe("assistant")
  })
})
