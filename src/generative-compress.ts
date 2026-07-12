import { gzipSync, gunzipSync } from "zlib"

export interface GenerativeCompressionOptions {
  enabled: boolean
  threshold: number
}

export function getGenerativeCompressionOptions(): GenerativeCompressionOptions {
  const enabled = process.env.CONTEXT_MANAGER_COMPRESS_WRITES === "1"
  const threshold = parseInt(process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD || "1000", 10)
  return { enabled, threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 1000 }
}

export interface CompressOutputOptions {
  enabled: boolean
  threshold: number
}

export function getCompressOutputOptions(): CompressOutputOptions {
  const enabled = process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT === "1"
  const threshold = parseInt(process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD || "500", 10)
  return { enabled, threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 500 }
}

const COMPRESSED_MARKER = /^--- compressed:([^\n]+) ---\n?/m
const END_MARKER = /\n--- end compressed ---\s*$/m

export function shouldCompressGenerativeOutput(text: string, threshold?: number): boolean {
  const opts = getGenerativeCompressionOptions()
  if (!opts.enabled) return false
  const limit = threshold ?? opts.threshold
  return text.length >= limit
}

export function shouldCompressOutputMessage(text: string, threshold?: number): boolean {
  const opts = getCompressOutputOptions()
  if (!opts.enabled) return false
  const limit = threshold ?? opts.threshold
  return text.length >= limit
}

export function compressGenerativeOutput(text: string): { base64: string; originalChars: number } {
  const originalChars = text.length
  const compressed = gzipSync(Buffer.from(text, "utf8"))
  const base64 = compressed.toString("base64")
  return { base64, originalChars }
}

export function wrapCompressedOutput(filePath: string, base64: string): string {
  return `--- compressed:${filePath} ---\n${base64}\n--- end compressed ---`
}

export function wrapCompressedMessage(role: string, base64: string): string {
  return `--- compressed:${role} ---\n${base64}\n--- end compressed ---`
}

export function compressMessage(text: string, role: string): { wrapped: string; originalChars: number; compressedChars: number } {
  const { base64, originalChars } = compressGenerativeOutput(text)
  return { wrapped: wrapCompressedMessage(role, base64), originalChars, compressedChars: base64.length }
}

export interface DecompressResult {
  filePath: string
  content: string
  originalChars: number
  compressedChars: number
}

export function tryDecompressGenerativeOutput(text: string): DecompressResult | undefined {
  const startMatch = COMPRESSED_MARKER.exec(text)
  if (!startMatch) return undefined
  const filePath = startMatch[1].trim()
  const endMatch = END_MARKER.exec(text)
  const endIndex = endMatch ? endMatch.index : text.length
  const base64 = text.slice(startMatch.index + startMatch[0].length, endIndex).trim()
  if (!base64) return undefined

  try {
    const compressed = Buffer.from(base64, "base64")
    if (compressed.length > 5 * 1024 * 1024) return undefined // decompression bomb cap
    const content = gunzipSync(compressed).toString("utf8")
    return {
      filePath,
      content,
      originalChars: content.length,
      compressedChars: base64.length,
    }
  } catch {
    return undefined
  }
}

export function stripCompressionMarkers(text: string): string {
  return text.replace(/--- compressed:[^\n]+ ---\n?/g, "").replace(/\n?--- end compressed ---\n?/g, "")
}

export function buildGenerativeCompressionInstruction(threshold: number): string {
  return [
    `When you need to write a file whose content is ${threshold}+ characters, wrap the full content in gzip+base64 markers to save output tokens.`,
    `Format:`,
    `--- compressed:<relative file path> ---`,
    `<gzip-compressed content as a single base64 string>`,
    `--- end compressed ---`,
    `Do not add markdown code fences. The plugin will decompress and write the file.`,
  ].join("\n")
}
