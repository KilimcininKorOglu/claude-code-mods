import { splitCjk } from './searchable.ts'

/** The most prefix terms one MATCH takes: the cost grows faster than the terms, and recall does not. */
export const MAX_TERMS = 64

/**
 * The shortest token that matches as a prefix. A two-letter token as a prefix matched most English
 * memories with a Turkish word: `ne` matched 128 of 206 memories of one store (`never`, `new`), `bu`
 * 64 (`build`), so it matches only as a whole word, which keeps terms such as `ci` and `pr`.
 */
export const MIN_PREFIX = 3

/**
 * A free text as distinct FTS5 terms, each quoted (`"term"*`) so neither punctuation nor a bare
 * `AND`, `OR`, `NOT` or `NEAR` can change the MATCH expression. A run of Chinese, Japanese or
 * Korean letters is split into its pairs, as the index holds it. One-character tokens are dropped,
 * a two-letter token (and so each pair) is an exact term, and a repeat is kept once. Every term of
 * the text is returned: a caller picks the `MAX_TERMS` it matches with (`heldTerms` picks the rarest
 * ones the store holds), because the first 64 of a pasted log left out the question at its end.
 */
export function ftsTerms(text: string): string[] {
  const terms = new Set<string>()
  for (const token of splitCjk(text).toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (token.length < 2) continue
    terms.add(token.length < MIN_PREFIX ? `"${token}"` : `"${token}"*`)
  }
  return [...terms]
}
