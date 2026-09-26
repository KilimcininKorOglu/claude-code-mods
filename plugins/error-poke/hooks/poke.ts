/** When a turn an API error killed is worth one continue prompt, and the texts the person reads. */

/** Continue prompts sent for one stretch of failures, until the person sets another limit. */
export const DEFAULT_MAX_POKES = 99

/** The band `/error-poke limit <n>` takes; a value outside it is refused, never clamped. */
export const MIN_LIMIT = 1
export const MAX_LIMIT = 999

/**
 * The prompt the mod sends. It names the cause and asks the model to carry on where it stopped, because
 * the interrupted turn's own work is still in the transcript and starting over would repeat it.
 */
export const POKE_TEXT =
  'The previous turn was cut off by an API error, not by me. Continue where you stopped; do not start over. ' +
  'If you cannot tell how far you got, say so and stop.'

/** What the mod does after one main-loop turn. */
export type Decision = 'idle' | 'poke' | 'limit'

/**
 * Whether the turn's end asks for a continue prompt. Only `error` counts: the engine reports a turn the
 * user interrupted as `aborted` and a model refusal as `refusal`, and neither is a failure to retry.
 */
export function decide(reason: string, pokes: number, max: number): Decision {
  if (reason !== 'error') return 'idle'
  return pokes >= max ? 'limit' : 'poke'
}

/** The limit a `/error-poke limit <word>` argument names, or undefined when it is not one. */
export function limitOf(arg: string): number | undefined {
  if (!/^\d{1,3}$/.test(arg)) return undefined
  const n = Number(arg)
  return n >= MIN_LIMIT && n <= MAX_LIMIT ? n : undefined
}

/** The answer of `/error-poke limit <n>`, or of an argument it cannot read. */
export function limitText(limit: number | undefined): string {
  if (limit === undefined) return `limit expects a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}`
  return `limit ${limit}: at most ${limit} continue prompt(s) go out for one stretch of failures`
}

/** The wait before the first continue prompt of a stretch of failures, in milliseconds. */
export const FIRST_DELAY_MS = 5_000

/** The longest wait between two continue prompts, in milliseconds. */
export const MAX_DELAY_MS = 300_000

/**
 * The wait before the `pokes`-th continue prompt: 5 s, then three times the last one, up to 5 minutes.
 * An overloaded API recovers in seconds, while an error that fails the same way on every try (a context
 * limit) would otherwise spend the whole limit of prompts back to back.
 */
export function pokeDelay(pokes: number): number {
  return Math.min(FIRST_DELAY_MS * 3 ** Math.max(pokes - 1, 0), MAX_DELAY_MS)
}

/** A usage limit as the session reports it. */
export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** A continue prompt held back until a usage limit resets: which limit, and when to send. */
export type LimitWait = { kind: string; until: number }

/** Claude Code's own text of a turn a usage limit stopped: `You've hit your session limit · resets 3:40pm`. */
const HIT_LIMIT = /hit your .*limit/i

/** Sent this long after the reset, so the first request does not race the limit's own clock. */
export const RESET_MARGIN_MS = 60_000

/**
 * Whether the turn died on a usage limit, and until when the continue prompt waits: a limit at 100% or
 * more waits for its reset (the latest, when several are full), and Claude Code's own limit text with no
 * limit at 100% waits for the fullest limit's reset. A retry before the reset only fails again, so the
 * backoff's prompts would all be spent on it. Undefined for any other error, and for a limit whose reset
 * is not in the future.
 */
export function limitWait(limits: readonly UsageLimit[], lastText: string, now: number): LimitWait | undefined {
  const future = limits.flatMap(l => {
    const at = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)
    return Number.isFinite(at) && at > now ? [{ limit: l, at }] : []
  })
  const full = future.filter(x => x.limit.percentUsed >= 100)
  if (full.length > 0) {
    const last = full.reduce((a, b) => (b.at > a.at ? b : a))
    return { kind: last.limit.kind, until: last.at + RESET_MARGIN_MS }
  }
  if (future.length === 0 || !HIT_LIMIT.test(lastText)) return undefined
  const fullest = future.reduce((a, b) => (b.limit.percentUsed > a.limit.percentUsed ? b : a))
  return { kind: fullest.limit.kind, until: fullest.at + RESET_MARGIN_MS }
}

/** A limit's short name: `5h`, `7d`, `spend`, or the engine's own word. */
function limitName(kind: string): string {
  return ({ five_hour: '5h', seven_day: '7d', spend_limit: 'spend' } as Record<string, string>)[kind] ?? kind.replaceAll('_', ' ')
}

/** A local clock time, `15:41`. */
function clockOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The line of a continue prompt held back until a limit resets: the limit red, the count as a poke's. */
export function limitWaitLines(w: LimitWait, now: number, pokes: number, max: number): Line[] {
  return [partsLine([
    part('the turn hit the ', undefined),
    part(`${limitName(w.kind)} usage limit`, 'error'),
    part(`, continuing at ${clockOf(w.until)} (in ${waitText(w.until - now)}) `, undefined),
    part(`(${pokes}/${max})`, countTone(pokes, max)),
  ])]
}

/** The wait as the person reads it: seconds under two minutes, whole minutes up to two hours, then hours and minutes. */
function waitText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 120) return `${s} s`
  const m = Math.round(s / 60)
  return m < 120 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** The line the person reads when a prompt is scheduled. The engine adds the mod name. */
export function pokeLog(pokes: number, max: number): string {
  return pokeLines(pokes, max).map(l => l.text).join('\n')
}

/** The line the person reads once the mod stops trying. */
export function limitLog(max: number): string {
  return limitLines(max).map(l => l.text).join('\n')
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The count's colour: yellow once it is within 10% of the limit, faint before. */
export function countTone(pokes: number, max: number): Tone {
  return pokes >= max * 0.9 ? 'warn' : 'dim'
}

/** `pokeLog` as a sidebar line: `API error` red, the count faint or yellow near the limit. */
export function pokeLines(pokes: number, max: number): Line[] {
  return [partsLine([
    part('the turn died on an ', undefined),
    part('API error', 'error'),
    part(`, continuing in ${waitText(pokeDelay(pokes))} `, undefined),
    part(`(${pokes}/${max})`, countTone(pokes, max)),
  ])]
}

/** `limitLog` as a sidebar line: the stop red, the way to reset faint. */
export function limitLines(max: number): Line[] {
  return [partsLine([part(`stopped after ${max} continue prompts`, 'error'), part('; the API keeps failing. ', undefined), part('Send a prompt to reset the count.', 'dim')])]
}

/** A `<head>: <detail>` event as a sidebar line: the head red, the detail in the default colour. */
export function eventLines(head: string, detail: string): Line[] {
  return [partsLine([part(head, 'error'), part(`: ${detail}`, undefined)])]
}

/**
 * The `/error-poke` answer. `reason` is how the last main-loop turn ended, so the person can tell whether
 * the engine reported their own error as `error` at all; it is empty until a turn has ended.
 */
export function statusText(enabled: boolean, pokes: number, max: number, reason?: string): string {
  const last = reason === undefined ? 'no turn has ended yet' : `last turn: ${reason}`
  return `${enabled ? 'on' : 'off'} · ${pokes}/${max} continue prompts since your last prompt · ${last}`
}
