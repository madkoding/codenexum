import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { compressToolOutput, getSemanticCompressionSaved, isCompressible } from "../src/mcp/compress"
import { getMaxFiles, getMaxFileBytes, isGeneratedPath, isOversized } from "../src/mcp/indexer"
import { parseSymbolRef, charsToTokens } from "@codenexum/core"

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"))
  writeFileSync(join(tmpDir, "app.ts"), "export const AppComponent = () => {}")
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("charsToTokens rounds correctly", () => {
  expect(charsToTokens(0)).toBe(0)
  expect(charsToTokens(10)).toBe(3)
  expect(charsToTokens(100)).toBe(25)
})

test("isCompressible returns true for compressible tools", () => {
  expect(isCompressible("read")).toBe(true)
  expect(isCompressible("bash")).toBe(true)
  expect(isCompressible("test")).toBe(true)
  expect(isCompressible("git")).toBe(true)
})

test("isCompressible returns false for unknown tools", () => {
  expect(isCompressible("unknown-cmd")).toBe(false)
})

test("getMaxFiles has reasonable default", () => {
  expect(getMaxFiles()).toBe(10000)
})

test("getMaxFileBytes has reasonable default", () => {
  expect(getMaxFileBytes()).toBe(1024 * 1024)
})

test("isGeneratedPath detects minified files", () => {
  expect(isGeneratedPath("bundle.min.js")).toBe(true)
  expect(isGeneratedPath("index.ts")).toBe(false)
})

test("isOversized flags large files", () => {
  const fp = join(tmpDir, "big.ts")
  writeFileSync(fp, "x".repeat(100))
  expect(isOversized(fp, 10)).toBe(true)
  expect(isOversized(fp, 10000)).toBe(false)
})

test("parseSymbolRef handles file:name format", () => {
  const fp = join(tmpDir, "app.ts")
  const result = parseSymbolRef(`${fp}:AppComponent`, tmpDir)
  expect(result).not.toBeNull()
  if (result) {
    expect(result.file).toBe(fp)
    expect(result.name).toBe("AppComponent")
  }
})

test("parseSymbolRef returns null for invalid format", () => {
  expect(parseSymbolRef("invalid")).toBeNull()
  expect(parseSymbolRef("")).toBeNull()
})

test("getSemanticCompressionSaved returns 0 initially", () => {
  expect(getSemanticCompressionSaved()).toBe(0)
})
