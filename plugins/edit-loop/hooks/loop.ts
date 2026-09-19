/** How many times each loop edited each file in the running turn, and the note at the threshold. */

/** The edit that reaches this count gets the note. */
export const THRESHOLD = 5

/** Edits per loop and file in the running turn; the main loop is `main`, a subagent its id. */
export type Counts = Map<string, number>

const key = (agentId: string | undefined, path: string): string => `${agentId ?? 'main'}\0${path}`

/** Counts one edit and answers whether this edit reached the threshold, which happens once per file and turn. */
export function countEdit(counts: Counts, agentId: string | undefined, path: string): boolean {
  const k = key(agentId, path)
  const n = (counts.get(k) ?? 0) + 1
  counts.set(k, n)
  return n === THRESHOLD
}

/** `path` shown relative to the session directory when it is inside it. */
export function shownPath(path: string, cwd: string): string {
  const base = `${cwd.replace(/\/+$/, '')}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

export function noteText(path: string): string {
  return `edit-loop: this turn edited ${path} ${THRESHOLD} times. Stop editing it, re-read the code path and state the root cause before the next edit.`
}
