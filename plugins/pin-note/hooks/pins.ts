/** What `/pin-note` asks for, and every text the mod writes. */

export type Action = { kind: 'list' } | { kind: 'enable'; on: boolean } | { kind: 'drop'; index: number } | { kind: 'add'; text: string }

/**
 * `on`, `off` and `drop <n>` are commands; any other text is a note, kept as typed, so a note may start
 * with `drop` when no number alone follows it.
 */
export function parseArgs(args: string): Action {
  const text = args.trim()
  if (text === '') return { kind: 'list' }
  if (text === 'on' || text === 'off') return { kind: 'enable', on: text === 'on' }
  const drop = /^drop\s+(\d+)$/.exec(text)
  return drop === null ? { kind: 'add', text } : { kind: 'drop', index: Number(drop[1]) }
}

/** The store key of one session's notes. */
export function pinsKey(sessionId: string): string {
  return `pins:${sessionId}`
}

/** The notes as a numbered list, one per line. */
function numbered(pins: readonly string[]): string {
  return pins.map((p, i) => `${i + 1}. ${p}`).join('\n')
}

export function listText(enabled: boolean, pins: readonly string[]): string {
  const head = enabled ? 'on' : 'off: /pin-note on to pin notes and have them sent again'
  return pins.length === 0 ? `${head} · no pinned notes` : `${head} · ${pins.length} pinned note(s):\n${numbered(pins)}`
}

export const OFF_TEXT = 'off: turn it on with /pin-note on first'

/** The command's answer to a new note; the model reads it as it is pinned. */
export function addedText(index: number, text: string): string {
  return `pinned note ${index}, kept for this session and sent to you again after each compaction and /clear:\n${text}`
}

export function droppedText(index: number, text: string): string {
  return `dropped note ${index}; it is no longer in force:\n${text}`
}

export function noSuchText(index: number, count: number): string {
  return count === 0 ? `there is no note ${index}: no note is pinned` : `there is no note ${index}: notes 1 to ${count} are pinned`
}

/** The context the model reads after a compaction or /clear. */
export function contextText(pins: readonly string[]): string {
  return `pin-note: the person pinned these notes for this session; they are still in force, follow them:\n${numbered(pins)}`
}

/** The person's line after the notes went out again. */
export function sentText(count: number, source: 'compact' | 'clear'): string {
  return `sent ${count} pinned note(s) again after ${source === 'compact' ? 'the compaction' : '/clear'}`
}
