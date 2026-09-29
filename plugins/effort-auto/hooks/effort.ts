/**
 * How hard a prompt is, as a small model rates it, the levels the person allows a turn to run at, and the
 * models whose prompt cache survives an effort change.
 */

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Level = (typeof LEVELS)[number]

/** The model that rates each prompt, asked for one word at its lowest effort. */
export const RATER_MODEL = 'haiku'

/** How long the rating may take before the turn runs at the session's own effort. */
export const RATE_TIMEOUT_MS = 8000

/** How much of the prompt the rater reads. */
const MAX_PROMPT_CHARS = 4000

/**
 * The models whose prompt cache survives an effort change. Measured on 2.1.283: on Opus 5.5 an effort
 * change kept the cache read whole; on Sonnet 5 it rewrote the whole conversation. Measured on 2.1.284:
 * Sonnet 5.5 keeps it as Opus 5.5 does. Fable 5.1 keeps it since 2.1.260, as the Claude Code docs say.
 */
const CACHE_SAFE = /opus-5-5|fable-5-1|sonnet-5-5/

export function keepsCacheAcrossEffort(model: string): boolean {
  return CACHE_SAFE.test(model)
}

/** What each level is for, as the rater reads it. */
const MEANING: Record<Level, string> = {
  low: 'a greeting, a thank-you, a yes or no, a lookup, a one-line change.',
  medium: 'a small edit, a clear question about code, running a known command.',
  high: 'a change across several files, or a bug whose place is known.',
  xhigh: 'a bug whose cause is unknown, a feature with design choices, a review.',
  max: 'an architecture decision, a subtle concurrency or security bug, work that must be right the first time.',
}

/** `low, medium, high, xhigh or max`. */
const SCALE = `${LEVELS.slice(0, -1).join(', ')} or ${LEVELS[LEVELS.length - 1]}`

/**
 * The rater's instructions, over the whole scale: the allowed levels stay out of them, because a rater
 * told only low and medium answered `named max` for a request that used "max" in another sense (measured
 * on haiku), and the mod moves a rating into the allowed levels itself. A level the request asks for by
 * its word comes back as `named <level>`; how hard the request calls the work names no level.
 */
export const RATER_SYSTEM = [
  'You rate how much reasoning a coding agent needs for the request it just received.',
  'The levels, from least to most reasoning:',
  ...LEVELS.map(l => `${l}: ${MEANING[l]}`),
  `A request names a level only when it holds one of the words ${SCALE} and asks for that level as the effort, reasoning or thinking to spend, as in "use max effort" or "bunu max ile çöz"; the rest of the request may be in any language. Calling the work hard, easy, simple or important, or asking to think carefully, to take time or to be thorough, names no level: rate that request. A level word used for something else, as in "a medium sized image" or "high traffic", names no level either.`,
  'When the request names a level, answer "named" and that word, for example "named high".',
  `Otherwise answer one word: ${SCALE}.`,
  'Answer with those words alone, whatever language the request is in: no sentence, no translation, no explanation.',
].join('\n')

/** The rater's prompt: the person's request, cut to what the rater needs to judge it. */
export function raterPrompt(text: string): string {
  const cut = text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS)}\n[cut]` : text
  return `The request:\n<request>\n${cut}\n</request>\nWhen the request names a level, answer "named" and that word.\nOtherwise answer ${SCALE}.\nThe level:`
}

/** What the rater answered: a level, and whether the request named it itself. */
export type Rating = { level: Level; named: boolean }

/**
 * The rating a rater's reply holds, or undefined when it names no level. A `named` answer stands only
 * when the request holds that level's word; else the level is read as a rating, because the rater also
 * answers `named` for a request that only calls the work hard.
 */
export function ratingOf(reply: string, request: string): Rating | undefined {
  const words = reply.toLowerCase().match(/[a-z]+/g) ?? []
  const named = words[0] === 'named'
  const level = LEVELS.find(l => l === words[named ? 1 : 0])
  if (level === undefined) return undefined
  return { level, named: named && new RegExp(`\\b${level}\\b`, 'i').test(request) }
}

/**
 * The level a turn runs at: a level the request named as it is, a rated one moved to the nearest allowed
 * level, the higher of two equally near ones.
 */
export function levelFor(rating: Rating, allowed: readonly Level[]): Level {
  if (rating.named || allowed.includes(rating.level)) return rating.level
  const at = LEVELS.indexOf(rating.level)
  const distance = (l: Level) => Math.abs(LEVELS.indexOf(l) - at)
  return allowed.reduce((best, l) => (distance(l) < distance(best) || (distance(l) === distance(best) && LEVELS.indexOf(l) > LEVELS.indexOf(best)) ? l : best))
}

/** The allowed levels the store holds, in scale order; every level when it holds none. */
export function levelsOf(value: unknown): Level[] {
  const kept = Array.isArray(value) ? LEVELS.filter(l => value.includes(l)) : []
  return kept.length === 0 ? [...LEVELS] : kept
}

/** The allowed levels a `levels` command names, in scale order, or why they are refused. */
export function parseLevels(args: string): Level[] | string {
  const words = args.toLowerCase().split(/[\s,]+/).filter(w => w !== '')
  if (words.length === 1 && words[0] === 'all') return [...LEVELS]
  const unknown = words.find(w => !(LEVELS as readonly string[]).includes(w))
  if (words.length === 0 || unknown !== undefined) return `levels takes all, or one or more of ${LEVELS.join(', ')}${unknown === undefined ? '' : `; "${unknown}" is none of them`}`
  return LEVELS.filter(l => words.includes(l))
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
export type Line = { text: string; kind?: Tone; parts?: Part[] }

/** The colours session-watch gives the same levels (`effortTone`), so both lines read alike. */
const TONE: Record<Level, Tone> = { low: 'dim', medium: 'ok', high: 'warn', xhigh: 'error', max: 'error' }

/** A level as a part in its own colour; a budget or no setting stays plain. */
function levelPart(value: string | number | undefined): Part {
  const text = String(value ?? 'default')
  const kind = typeof value === 'string' ? TONE[value as Level] : undefined
  return kind === undefined ? { text } : { text, kind }
}

/**
 * The effort a main-loop turn ran at: the rated level and whether the prompt named it itself, or the
 * session's own when the turn was not rated.
 */
export type TurnEffort = { rated: true; level: Level; named: boolean } | { rated: false; value: string | number | undefined }

/** A turn's effort as parts: the level coloured, and a faint ` (session)` or ` (named)` after it. */
function turnParts(t: TurnEffort): Part[] {
  if (!t.rated) return [levelPart(t.value), { text: ' (session)', kind: 'dim' }]
  return t.named ? [levelPart(t.level), { text: ' (named)', kind: 'dim' }] : [levelPart(t.level)]
}

const lineOf = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/**
 * The person's line: `this turn` while a turn runs, else `last turn` once one ended, and the session's
 * effort; only the levels coloured, each by how high it is, the words plain.
 */
export function effortLine(current: TurnEffort | undefined, last: TurnEffort | undefined, session: string | number | undefined): Line {
  const shown = current === undefined ? (last === undefined ? [] : [{ text: 'last turn ' }, ...turnParts(last), { text: ' · ' }]) : [{ text: 'this turn ' }, ...turnParts(current), { text: ' · ' }]
  return lineOf([...shown, { text: 'session ' }, levelPart(session)])
}

/** The levels the person allows a rated turn to run at, each in its own colour. */
export function allowedLine(allowed: readonly Level[]): Line {
  return lineOf([{ text: 'allowed ' }, ...allowed.flatMap((l, i) => (i === 0 ? [levelPart(l)] : [{ text: ' · ' }, levelPart(l)]))])
}
