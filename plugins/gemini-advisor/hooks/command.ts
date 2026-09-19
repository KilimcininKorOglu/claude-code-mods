/** The setting /gemini-advisor changes, and the reading of its argument. */
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

/** Reads the argument of /gemini-advisor. */
export function parseCommand(args: string): Command {
  return WORDS[args.trim()] ?? { kind: 'error', text: USAGE }
}

/** What `on` answers while gemini-core has no key; nothing is stored. */
export const NO_KEY_ON = 'still off: gemini-core has no Gemini key. Set GEMINI_API_KEY or the gemini-core apiKey option, restart Claude Code, then run /gemini-advisor on'

/** What `reset` answers: the advisor is off until it is turned on. */
export const RESET_TEXT = 'off: back to the default; /gemini-advisor on turns it on'

/**
 * The line /gemini-advisor prints for a change. The system prompt note only
 * changes at a session start or /clear, so the prompt cache holds.
 */
export function changeText(enabled: boolean): string {
  return enabled
    ? 'on: the advise tool is available now; the system prompt note that says when to call it comes at /clear or the next session'
    : 'off: a call answers that the advisor is off; the note leaves at /clear or the next session, the tool at the next session'
}

/** The status of /gemini-advisor, with what gemini-core says it runs with. */
export function statusText(enabled: boolean, s: GeminiSettings, last: string | undefined): string {
  const key = s.hasKey ? 'key set' : 'no key: set GEMINI_API_KEY or the gemini-core apiKey option'
  const lines = [`${enabled ? 'on' : 'off'} · ${s.model} · thinking ${s.thinking ?? 'model default'} · ${s.tier} tier · ${key}`]
  if (!enabled) lines.push('off until /gemini-advisor on; the model, the thinking level and the tier are /gemini-core settings')
  if (last !== undefined) lines.push(`last: ${last}`)
  return lines.join('\n')
}
