// Conversation context tracking for "smart read" mode.
// We keep a short sliding window of user text so that when a large file is
// read we can return only the chunks most likely relevant to the current
// question.

export class ConversationContext {
  private terms: string[] = []
  private maxTerms: number

  constructor(maxTerms = 30) {
    this.maxTerms = maxTerms
  }

  addUserText(text: string): void {
    if (process.env.CONTEXT_MANAGER_SMART_READ !== "1") return
    const newTerms = extractTerms(text)
    this.terms.push(...newTerms)
    if (this.terms.length > this.maxTerms) {
      this.terms = this.terms.slice(-this.maxTerms)
    }
  }

  getTerms(): string[] {
    return Array.from(new Set(this.terms))
  }

  clear(): void {
    this.terms = []
  }
}

function extractTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length >= 3)
    .slice(0, 10)
}
