/** The setting /gemini-plan-review changes, and the reading of its argument. */
import type { EngineInterface } from 'claude-code'

/** What gemini-core says this mod runs with. */
export type GeminiSettings = Awaited<ReturnType<EngineInterface['gemini']['settings']>>

export type Command = { kind: 'status' } | { kind: 'reset' } | { kind: 'set'; enabled: boolean } | { kind: 'error'; text: string }

export const USAGE = 'expects on, off, or reset; /gemini-core sets the model, the thinking level and the tier'

/** The store key of the on/off setting. */
export const ENABLED_KEY = 'enabled'

const WORDS: Record<string, Command> = {
  '': { kind: 'status' },
  status: { kind: 'status' },
  reset: { kind: 'reset' },
  on: { kind: 'set', enabled: true },
  off: { kind: 'set', enabled: false },
}

/** Reads the argument of /gemini-plan-review. */
export function parseCommand(args: string): Command {
  return WORDS[args.trim()] ?? { kind: 'error', text: USAGE }
}

/** What `on` answers while gemini-core has no key; nothing is stored. */
export const NO_KEY_ON = 'still off: gemini-core has no Gemini key. Set GEMINI_API_KEY or the gemini-core apiKey option, restart Claude Code, then run /gemini-plan-review on'

/** What `reset` answers: the review is off until it is turned on. */
export const RESET_TEXT = 'off: back to the default; /gemini-plan-review on turns it on'

/** The line /gemini-plan-review prints for a change. */
export function changeText(enabled: boolean): string {
  return enabled ? 'on: every plan is reviewed before it reaches you' : 'off: plans reach you without a review'
}

/** The status of /gemini-plan-review, with what gemini-core says it runs with. */
export function statusText(enabled: boolean, s: GeminiSettings, last: string | undefined): string {
  const key = s.hasKey ? 'key set' : 'no key: set GEMINI_API_KEY or the gemini-core apiKey option'
  const lines = [`${enabled ? 'on' : 'off'} · ${s.model} · thinking ${s.thinking ?? 'model default'} · ${s.tier} tier · ${key}`]
  if (!enabled) lines.push('off until /gemini-plan-review on; the model, the thinking level and the tier are /gemini-core settings')
  if (last !== undefined) lines.push(`last: ${last}`)
  return lines.join('\n')
}
