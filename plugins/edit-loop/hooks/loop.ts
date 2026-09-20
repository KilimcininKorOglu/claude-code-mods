/** How many times each loop edited each file in the running turn, and the note at the threshold. */

/** The edit that reaches this count gets the note the model reads. */
export const THRESHOLD = 5

/** The edit that reaches this count gets the first warning, to the person only. */
export const WARN_THRESHOLD = 3

/** Edits per loop and file in the running turn; the main loop is `main`, a subagent its id. */
export type Counts = Map<string, number>

const key = (agentId: string | undefined, path: string): string => `${agentId ?? 'main'}\0${path}`

/** Counts one edit and answers how many times this loop has edited that file in this turn. */
export function countEdit(counts: Counts, agentId: string | undefined, path: string): number {
  const k = key(agentId, path)
  const n = (counts.get(k) ?? 0) + 1
  counts.set(k, n)
  return n
}

/** `path` shown relative to the session directory when it is inside it. */
export function shownPath(path: string, cwd: string): string {
  const base = `${cwd.replace(/\/+$/, '')}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

export function noteText(path: string): string {
  return `edit-loop: this turn edited ${path} ${THRESHOLD} times. Stop editing it, re-read the code path and state the root cause before the next edit.`
}

/** The transcript line: the finding alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(path: string, count = THRESHOLD): string {
  return `${count}${count === WARN_THRESHOLD ? 'rd' : 'th'} edit of ${path} in this turn`
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
