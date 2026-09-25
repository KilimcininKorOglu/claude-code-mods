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
  return sidebarLines(path, count).map(l => l.text).join('\n')
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** `logText` as a sidebar line: the ordinal yellow at the warning and red at the note, the path default, the rest faint. */
export function sidebarLines(path: string, count = THRESHOLD): Line[] {
  const ordinal = `${count}${count === WARN_THRESHOLD ? 'rd' : 'th'}`
  return [partsLine([part(ordinal, count === WARN_THRESHOLD ? 'warn' : 'error'), part(` edit of ${path}`, undefined), part(' in this turn', 'dim')])]
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
