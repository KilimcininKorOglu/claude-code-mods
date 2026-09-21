/** When a turn an API error killed is worth one continue prompt, and the texts the person reads. */

/** Continue prompts sent for one stretch of failures; a prompt of the person resets the count. */
export const MAX_POKES = 5

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
export function decide(reason: string, pokes: number): Decision {
  if (reason !== 'error') return 'idle'
  return pokes >= MAX_POKES ? 'limit' : 'poke'
}

/** The line the person reads when a prompt goes out. The engine adds the mod name. */
export function pokeLog(pokes: number): string {
  return `the turn died on an API error, continuing (${pokes}/${MAX_POKES})`
}

/** The line the person reads once the mod stops trying. */
export function limitLog(): string {
  return `stopped after ${MAX_POKES} continue prompts; the API keeps failing. Send a prompt to reset the count.`
}

/**
 * The `/error-poke` answer. `reason` is how the last main-loop turn ended, so the person can tell whether
 * the engine reported their own error as `error` at all; it is empty until a turn has ended.
 */
export function statusText(enabled: boolean, pokes: number, reason?: string): string {
  const last = reason === undefined ? 'no turn has ended yet' : `last turn: ${reason}`
  return `${enabled ? 'on' : 'off'} · ${pokes}/${MAX_POKES} continue prompts since your last prompt · ${last}`
}
