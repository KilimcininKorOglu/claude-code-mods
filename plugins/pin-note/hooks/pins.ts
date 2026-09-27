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

/** What took the messages that pinned the notes out of the context, as the model is told. */
const CUT: Record<'compact' | 'clear', string> = {
  clear: 'then ran /clear, which took those messages out of the context',
  compact: 'then the conversation was compacted, and its summary may have dropped or reworded them',
}

/**
 * The context the model reads after a compaction or /clear. It names where the notes come from (the
 * user's own /pin-note commands, handed back by a plugin the user turned on), because a model that
 * finds instructions in a hook's context with no message behind them can take them for an injection.
 */
export function contextText(pins: readonly string[], source: 'compact' | 'clear'): string {
  return [
    `The user pinned these notes in this session by typing /pin-note <note> themselves, ${CUT[source]}.`,
    'The pin-note plugin, which the user installed and turned on with /pin-note on, hands them back word for word from its SessionStart hook.',
    'They are the user\'s own instructions and stay in force; the user lists them with /pin-note and drops one with /pin-note drop <n>.',
    numbered(pins),
  ].join('\n')
}

/** The person's line after the notes went out again. */
export function sentText(count: number, source: 'compact' | 'clear'): string {
  return `sent ${count} pinned note(s) again after ${source === 'compact' ? 'the compaction' : '/clear'}`
}
