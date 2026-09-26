export const STYLES = ['matrix', 'fire', 'stars', 'aquarium', 'life'] as const
export type Style = (typeof STYLES)[number]

/** A stored style, or `random`: a new style at each turn, never the one before it. */
export type Choice = Style | 'random'

export type Config = { enabled: boolean; style: Choice; delaySec: number }

export const DEFAULT_DELAY_SEC = 3
export const MAX_DELAY_SEC = 60

/** Rows the band takes at most, and columns. */
export const BAND_ROWS = 8
export const BAND_COLUMNS = 100

export function isStyle(v: unknown): v is Style {
  return typeof v === 'string' && (STYLES as readonly string[]).includes(v)
}

/** The settings as the store holds them; a missing or broken value takes its default. */
export function configOf(enabled: unknown, style: unknown, delay: unknown): Config {
  const delaySec = typeof delay === 'number' && Number.isInteger(delay) && delay >= 0 && delay <= MAX_DELAY_SEC ? delay : DEFAULT_DELAY_SEC
  return { enabled: enabled !== false, style: isStyle(style) ? style : 'random', delaySec }
}

/** The style of a new turn: the stored one, or at random any style but the last. */
export function pickStyle(choice: Choice, last: Style | null, rng: () => number): Style {
  if (choice !== 'random') return choice
  const pool = STYLES.filter(s => s !== last)
  return pool[Math.floor(rng() * pool.length)] ?? 'matrix'
}

export type Action =
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'enable'; enabled: boolean }
  | { kind: 'style'; style: Choice }
  | { kind: 'delay'; seconds: number }
  | { kind: 'error'; text: string }

const USAGE = `/idle-art [on | off | ${STYLES.join(' | ')} | random | delay <0-${MAX_DELAY_SEC}> | help]`

function delayAction(value: string | undefined): Action {
  const n = Number(value)
  if (value === undefined || !Number.isInteger(n) || n < 0 || n > MAX_DELAY_SEC) return { kind: 'error', text: `delay takes whole seconds from 0 to ${MAX_DELAY_SEC}. Usage: ${USAGE}` }
  return { kind: 'delay', seconds: n }
}

/** What a `/idle-art` argument asks for. */
export function parseArgs(args: string): Action {
  const [word = '', value, extra] = args.trim().toLowerCase().split(/\s+/)
  // Only `delay` takes a value.
  if (extra !== undefined || (value !== undefined && word !== 'delay')) return { kind: 'error', text: `too many arguments. Usage: ${USAGE}` }
  if (word === 'delay') return delayAction(value)
  return wordAction(word)
}

/** What a single-word argument asks for. */
function wordAction(word: string): Action {
  const fixed: Record<string, Action> = { '': { kind: 'status' }, help: { kind: 'help' }, on: { kind: 'enable', enabled: true }, off: { kind: 'enable', enabled: false } }
  const action = fixed[word]
  if (action !== undefined) return action
  if (word === 'random' || isStyle(word)) return { kind: 'style', style: word }
  return { kind: 'error', text: `unknown argument: ${word}. Usage: ${USAGE}` }
}

export function statusText(c: Config): string {
  return `${c.enabled ? 'on' : 'off'} · style ${c.style} · shows ${c.delaySec}s into a turn`
}

export function helpText(c: Config): string {
  return [
    statusText(c),
    `Usage: ${USAGE}`,
    'on, off: draw or stop drawing the animation above the prompt while the model works.',
    `${STYLES.join(', ')}: always draw that one. random: a new one each turn.`,
    'delay <n>: wait n seconds into a turn before drawing, so short turns show nothing.',
  ].join('\n')
}
