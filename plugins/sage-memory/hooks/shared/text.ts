/**
 * Text normalization shared by the hooks module and the daemon. Pure code: no `$`, no Node API,
 * because both the hooks environment and Node import this file.
 */

/** Collapses every run of whitespace to one space and trims the ends. */
export function collapseSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The comparison key of a text: NFKC, lowercase, whitespace collapsed. */
export function textKey(text: string): string {
  return collapseSpace(text.normalize('NFKC').toLowerCase())
}

/**
 * The duplicate key of a memory text: `textKey` without trailing sentence punctuation, so
 * "Use pnpm." and "Use pnpm" match while `C++` and `foo.bar` inside the text stay whole.
 */
export function canonicalText(text: string): string {
  return textKey(text).replace(/[.!?,;:]+$/u, '')
}

/**
 * The distinct terms of a text for scoring: NFKC, lowercase, split on anything that is not a
 * letter, a digit, `_`, `.` or `-` (so `snake_case`, `edge-case` and `foo.bar` stay whole), and
 * terms of fewer than 3 characters dropped, because those match nearly every text.
 */
export function tokenize(text: string): string[] {
  const terms = text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}_.-]+/u)
  return [...new Set(terms.filter(term => term.length >= 3))]
}

/** Tags lowercased, a leading `#` dropped, blanks and repeats removed. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const cleaned = (tags ?? []).map(tag => tag.replace(/^#/, '').trim().toLowerCase())
  return [...new Set(cleaned.filter(tag => tag !== ''))]
}
