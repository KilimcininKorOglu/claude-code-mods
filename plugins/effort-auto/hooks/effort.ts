/** How hard a prompt is, as a small model rates it, and the models whose prompt cache survives an effort change. */

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
 * change kept the cache read whole; on Sonnet 5 it rewrote the whole conversation. Fable 5.1 keeps it
 * since 2.1.260, as the Claude Code docs say.
 */
const CACHE_SAFE = /opus-5-5|fable-5-1/

export function keepsCacheAcrossEffort(model: string): boolean {
  return CACHE_SAFE.test(model)
}

export const RATER_SYSTEM = [
  'You rate how much reasoning a coding agent needs for the request it just received.',
  'Answer with one word and nothing else: low, medium, high, xhigh or max.',
  'low: a greeting, a thank-you, a yes or no, a lookup, a one-line change.',
  'medium: a small edit, a clear question about code, running a known command.',
  'high: a change across several files, or a bug whose place is known.',
  'xhigh: a bug whose cause is unknown, a feature with design choices, a review.',
  'max: an architecture decision, a subtle concurrency or security bug, work that must be right the first time.',
].join('\n')

/** The rater's prompt: the person's request, cut to what the rater needs to judge it. */
export function raterPrompt(text: string): string {
  const cut = text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS)}\n[cut]` : text
  return `The request:\n<request>\n${cut}\n</request>\nThe level:`
}

/** The level a rater's reply names, or undefined when it names none. */
export function levelOf(reply: string): Level | undefined {
  const word = reply.trim().toLowerCase().match(/[a-z]+/)?.[0]
  return LEVELS.find(l => l === word)
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

/** The person's line: only the two levels coloured, each by how high it is; the words stay plain. */
export function turnLine(level: Level, session: string | number | undefined): Line {
  const parts: Part[] = [{ text: 'this turn ' }, levelPart(level), { text: ' · session ' }, levelPart(session)]
  return { text: parts.map(p => p.text).join(''), parts }
}
