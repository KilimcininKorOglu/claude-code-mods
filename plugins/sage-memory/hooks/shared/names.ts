/**
 * Names a prompt can give a memory by: identifiers, file names, versions and other tokens whose
 * shape marks them as names rather than words of a language. A token is a run of letters, digits
 * and `_ . / -` that stops at any other character and at a Chinese, Japanese or Korean character,
 * so a name written next to such text with no space ("minSdkはなぜ") is still found, and a
 * Turkish suffix after an apostrophe ("CACHE_TTL'i") is cut off.
 */

const TOKEN = /[\p{L}\p{N}_][\p{L}\p{N}_./-]*/gu
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/u
const TRAILING = /[./-]+$/

/** A name is at least this long, so two-character tokens such as "29" or "ok" name nothing. */
const MIN_NAME = 3

/** Every token of a text, lower case, a trailing `.`, `/` or `-` cut off. */
export function tokensOf(text: string): string[] {
  const tokens: string[] = []
  for (const run of text.normalize('NFKC').split(CJK)) {
    for (const match of run.matchAll(TOKEN)) {
      const token = match[0].replace(TRAILING, '').toLowerCase()
      if (token !== '') tokens.push(token)
    }
  }
  return tokens
}

/**
 * A token in the shape of a name: it holds a digit, an `_`, a `.` or `/` inside it, a `-` inside
 * it, or a lower-case letter followed by a capital (read from the original text).
 */
function isNameShaped(original: string): boolean {
  if (original.length < MIN_NAME) return false
  return /\p{N}/u.test(original) || /[_./-]/.test(original) || /\p{Ll}\p{Lu}/u.test(original)
}

/** The distinct names a prompt holds, lower case. */
export function namesOf(text: string): string[] {
  const names = new Set<string>()
  for (const run of text.normalize('NFKC').split(CJK)) {
    for (const match of run.matchAll(TOKEN)) {
      const original = match[0].replace(TRAILING, '')
      if (isNameShaped(original)) names.add(original.toLowerCase())
    }
  }
  return [...names]
}

/** The last part of a path, lower case. */
export function baseNameOf(path: string): string {
  return (path.replace(/\/+$/, '').split('/').at(-1) ?? '').toLowerCase()
}
