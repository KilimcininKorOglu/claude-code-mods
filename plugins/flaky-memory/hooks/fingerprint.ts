/** The fingerprint of a working tree: two runs with the same one ran on the same code. */

/** A diff over this is not hashed, and the run is not recorded. */
export const MAX_DIFF_CHARS = 4 * 1024 * 1024

const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** FNV-1a over the UTF-16 code units, 64 bits, as 16 hex digits. */
export function fnv1a(text: string): string {
  let hash = OFFSET
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/** What git says about the tree: the commit, the changes against it, and the untracked file names. */
export type TreeState = { head: string; diff: string; untracked: string }

/** The fingerprint, or undefined when the diff is too large to hash. */
export function fingerprintOf(s: TreeState): string | undefined {
  if (s.diff.length > MAX_DIFF_CHARS) return undefined
  return fnv1a(`${s.head.trim()}\n${s.diff}\n${s.untracked}`)
}
