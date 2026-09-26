export const STYLES = ['matrix', 'fire', 'stars', 'aquarium', 'cat'] as const
export type Style = (typeof STYLES)[number]

/**
 * A stored choice: a built-in style, the name of a saved clip, or `random`, a
 * new one at each turn from both, never the one before it.
 */
export type Choice = string

export type Config = { enabled: boolean; style: Choice; delaySec: number }

export const DEFAULT_DELAY_SEC = 3
export const MAX_DELAY_SEC = 60

/** Rows the band takes at most; a scene takes the band's whole width. */
export const BAND_ROWS = 8
/** Columns an imported clip may take at most. */
export const CLIP_COLUMNS = 100

/** Words the command reads itself, so no clip may take them as its name. */
const RESERVED = new Set(['random', 'on', 'off', 'help', 'delay', 'import', 'list', 'remove'])

/** A clip name: lowercase letters, digits and dashes, starting with a letter or digit, up to 24 characters. */
const NAME = /^[a-z0-9][a-z0-9-]{0,23}$/

/** One showing of a scene: its style and seed, which an instance names when it asks to leave it. */
export function sceneOf(p: { style: string; seed: number }): string {
  return `${p.style}:${p.seed}`
}

export function isStyle(v: unknown): v is Style {
  return typeof v === 'string' && (STYLES as readonly string[]).includes(v)
}

/** Why a name cannot be a clip's, or null when it can. */
export function nameProblem(name: string): string | null {
  if (!NAME.test(name)) return `${name} is not a clip name: use lowercase letters, digits and dashes, up to 24 characters`
  if (RESERVED.has(name) || isStyle(name)) return `${name} is taken by the command or a built-in scene`
  return null
}

/** The settings as the store holds them; a missing or broken value takes its default. */
export function configOf(enabled: unknown, style: unknown, delay: unknown, clips: readonly string[]): Config {
  const delaySec = typeof delay === 'number' && Number.isInteger(delay) && delay >= 0 && delay <= MAX_DELAY_SEC ? delay : DEFAULT_DELAY_SEC
  const known = isStyle(style) || (typeof style === 'string' && clips.includes(style))
  return { enabled: enabled !== false, style: known ? (style as string) : 'random', delaySec }
}

/** The scene of a new turn: the stored one, or at random any built-in style or clip but the last. */
export function pickStyle(choice: Choice, last: string | null, rng: () => number, clips: readonly string[] = []): string {
  if (choice !== 'random') return choice
  const all = [...STYLES, ...clips]
  const pool = all.length > 1 ? all.filter(s => s !== last) : all
  return pool[Math.floor(rng() * pool.length)] ?? 'matrix'
}

export type Action =
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'enable'; enabled: boolean }
  | { kind: 'style'; style: Choice }
  | { kind: 'delay'; seconds: number }
  | { kind: 'import'; path: string; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'error'; text: string }

const USAGE = `/idle-art [on | off | ${STYLES.join(' | ')} | <clip> | random | delay <0-${MAX_DELAY_SEC}> | import <gif path> <name> | list | remove <name> | help]`

const tooMany: Action = { kind: 'error', text: `too many arguments. Usage: ${USAGE}` }

function delayAction(rest: string[]): Action {
  const [value] = rest
  const n = Number(value)
  if (rest.length > 1) return tooMany
  if (value === undefined || !Number.isInteger(n) || n < 0 || n > MAX_DELAY_SEC) return { kind: 'error', text: `delay takes whole seconds from 0 to ${MAX_DELAY_SEC}. Usage: ${USAGE}` }
  return { kind: 'delay', seconds: n }
}

/** `import <path> <name>`: the name is the last word, so a path may hold spaces. */
function importAction(rest: string[]): Action {
  if (rest.length < 2) return { kind: 'error', text: `import takes a GIF path and a name. Usage: ${USAGE}` }
  const name = (rest[rest.length - 1] as string).toLowerCase()
  const problem = nameProblem(name)
  if (problem !== null) return { kind: 'error', text: problem }
  return { kind: 'import', path: rest.slice(0, -1).join(' '), name }
}

function removeAction(rest: string[]): Action {
  if (rest.length !== 1) return { kind: 'error', text: `remove takes one clip name. Usage: ${USAGE}` }
  return { kind: 'remove', name: (rest[0] as string).toLowerCase() }
}

const WITH_VALUE: Record<string, (rest: string[]) => Action> = { delay: delayAction, import: importAction, remove: removeAction }

/** What a `/idle-art` argument asks for. The keyword reads case-blind; a path keeps its case. */
export function parseArgs(args: string): Action {
  const [first = '', ...rest] = args.trim().split(/\s+/)
  const word = first.toLowerCase()
  const withValue = WITH_VALUE[word]
  if (withValue !== undefined) return withValue(rest)
  return rest.length > 0 ? tooMany : wordAction(word)
}

/** What a single-word argument asks for; a word the command does not know names a scene or a clip. */
function wordAction(word: string): Action {
  const fixed: Record<string, Action> = { '': { kind: 'status' }, help: { kind: 'help' }, list: { kind: 'list' }, on: { kind: 'enable', enabled: true }, off: { kind: 'enable', enabled: false } }
  return fixed[word] ?? { kind: 'style', style: word }
}

export function unknownText(word: string, clips: readonly string[]): string {
  return `unknown scene: ${word}. Scenes: ${[...STYLES, ...clips].join(', ')}. Usage: ${USAGE}`
}

export function statusText(c: Config): string {
  return `${c.enabled ? 'on' : 'off'} · style ${c.style} · shows ${c.delaySec}s into a turn`
}

export function helpText(c: Config): string {
  return [
    statusText(c),
    `Usage: ${USAGE}`,
    'on, off: draw or stop drawing the animation above the prompt while the model works.',
    `${STYLES.join(', ')}, or a saved clip's name: always draw that one. random: a new one each turn, clips included.`,
    'delay <n>: wait n seconds into a turn before drawing, so short turns show nothing.',
    'import <gif path> <name>: turn a GIF into a character clip and keep it under that name, for every project.',
    'list: the built-in scenes and the saved clips. remove <name>: delete a saved clip.',
  ].join('\n')
}
