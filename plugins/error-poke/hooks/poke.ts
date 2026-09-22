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

/** The wait as the person reads it: seconds under two minutes, whole minutes above. */
function waitText(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`
}

/** The line the person reads when a prompt is scheduled. The engine adds the mod name. */
export function pokeLog(pokes: number, max: number): string {
  return `the turn died on an API error, continuing in ${waitText(pokeDelay(pokes))} (${pokes}/${max})`
}

/** The line the person reads once the mod stops trying. */
export function limitLog(max: number): string {
  return `stopped after ${max} continue prompts; the API keeps failing. Send a prompt to reset the count.`
}

/**
 * The `/error-poke` answer. `reason` is how the last main-loop turn ended, so the person can tell whether
 * the engine reported their own error as `error` at all; it is empty until a turn has ended.
 */
export function statusText(enabled: boolean, pokes: number, max: number, reason?: string): string {
  const last = reason === undefined ? 'no turn has ended yet' : `last turn: ${reason}`
  return `${enabled ? 'on' : 'off'} · ${pokes}/${max} continue prompts since your last prompt · ${last}`
}
