/** The most prefix terms one MATCH takes: the cost grows faster than the terms, and recall does not. */
const MAX_TERMS = 64

/**
 * A free text as distinct FTS5 prefix terms, each quoted (`"term"*`) so neither punctuation nor a
 * bare `AND`, `OR`, `NOT` or `NEAR` can change the MATCH expression. One-character tokens are
 * dropped, and a repeat takes no second place among the 64.
 */
export function ftsTerms(text: string): string[] {
  const terms = new Set<string>()
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (token.length < 2) continue
    terms.add(`"${token}"*`)
    if (terms.size >= MAX_TERMS) break
  }
  return [...terms]
}
