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

/** The line /gemini-advisor prints for a change. */
export function changeText(enabled: boolean): string {
  return enabled ? 'on' : 'off: the model is told the advisor is off when it calls it'
}

/** The status of /gemini-advisor, with what gemini-core says it runs with. */
export function statusText(enabled: boolean, s: GeminiSettings, last: string | undefined): string {
  const key = s.hasKey ? 'key set' : 'no key: set GEMINI_API_KEY or the gemini-core apiKey option'
  const lines = [`${enabled ? 'on' : 'off'} · ${s.model} · thinking ${s.thinking ?? 'model default'} · ${s.tier} tier · ${key}`]
  if (last !== undefined) lines.push(`last: ${last}`)
  return lines.join('\n')
}
