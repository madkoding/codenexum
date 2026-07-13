// Token counting with optional real tokenizer (gpt-tokenizer cl100k_base).
// Falls back silently to the ~4 chars/token heuristic if the real tokenizer
// is unavailable or fails. Keeps the plugin self-contained: no hard npm
// dependency is declared, so the user can install gpt-tokenizer separately
// if they want exact counts.



export type TokenizerMode = "tiktoken" | "estimate"

export interface Tokenizer {
  mode: TokenizerMode
  count(text: string): number
  resetCache?(): void
}

class HeuristicTokenizer implements Tokenizer {
  mode: TokenizerMode = "estimate"

  count(text: string): number {
    return text ? Math.max(0, Math.round(text.length / 4)) : 0
  }
}

const HEURISTIC = new HeuristicTokenizer()

class LazyTiktokenTokenizer implements Tokenizer {
  mode: TokenizerMode = "tiktoken"
  private cache = new Map<string, number>()
  private impl?: { encode(text: string): number[] }
  private resolved = false

  constructor(private maxCache: number) {}

  count(text: string): number {
    if (!text) return 0
    if (!this.resolved) this.resolve()
    if (!this.impl) return HEURISTIC.count(text)

    const cached = this.cache.get(text)
    if (cached !== undefined) return cached

    let n: number
    try {
      n = this.impl.encode(text).length
    } catch {
      return HEURISTIC.count(text)
    }

    if (this.cache.size >= this.maxCache) {
      // LRU-ish eviction: drop oldest key.
      const first = this.cache.keys().next().value
      if (first !== undefined) this.cache.delete(first)
    }
    this.cache.set(text, n)
    return n
  }

  resetCache(): void {
    this.cache.clear()
  }

  private resolve(): void {
    this.resolved = true
    try {
      const mod = require("gpt-tokenizer/esm/encoding/cl100k_base")
      if (mod && typeof mod.encode === "function") {
        this.impl = mod
        return
      }
    } catch {
      /* ignore */
    }

    try {
      const mod = require("gpt-tokenizer")
      if (mod && typeof mod.encode === "function") {
        this.impl = mod
        return
      }
    } catch {
      /* ignore */
    }

    this.impl = undefined
  }
}

let activeTokenizer: Tokenizer | undefined

function createTokenizer(): Tokenizer {
  const mode = process.env.CODENEXUM_TOKENIZER || "tiktoken"
  if (mode === "estimate") return HEURISTIC
  // Unknown mode: fall back to tiktoken with silent heuristic fallback.
  const cacheSize = Math.max(1, parseInt(process.env.CODENEXUM_TOKEN_CACHE_SIZE || "200", 10))
  return new LazyTiktokenTokenizer(cacheSize)
}

/** Return the active tokenizer, creating it on first call. */
export function getTokenizer(): Tokenizer {
  if (!activeTokenizer) {
    activeTokenizer = createTokenizer()
  }
  return activeTokenizer
}

/** Reset the active tokenizer (mostly useful in tests). */
export function resetTokenizer(): void {
  activeTokenizer = undefined
}

/** Estimate token count for the given text. */
export function estimateTokens(text: string): number {
  return getTokenizer().count(text)
}

/** Backwards-compatible helper: approximate tokens from a character count.
 *  Keeps the fast 4 chars/token heuristic so callers that only have a char
 *  count (e.g. budget savings) don't pay the cost of materializing a huge
 *  dummy string.  Use estimateTokens(text) when the real text is available.
 */
export function charsToTokens(chars: number): number {
  return chars ? Math.max(0, Math.round(chars / 4)) : 0
}

/** Reset the tokenizer's internal cache, if any. */
export function resetTokenCache(): void {
  getTokenizer().resetCache?.()
}

/** Current mode identifier. */
export function tokenizerMode(): TokenizerMode {
  return getTokenizer().mode
}
