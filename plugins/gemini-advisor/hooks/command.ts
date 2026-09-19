/** The settings /gemini-advisor changes, and the reading of its argument. */
import { MODEL_ID } from './gemini.ts'

export type Tier = 'free' | 'paid'

export type Settings = { enabled: boolean; tier: Tier; model: string }

export type Patch = Partial<Settings>

export type Command =
  | { kind: 'status' }
  | { kind: 'reset' }
  | { kind: 'set'; patch: Patch }
  | { kind: 'error'; text: string }

export const USAGE = 'expects on, off, free, paid, model <id>, or reset'

/** The store key of each setting. */
export const STORE_KEYS: Record<keyof Settings, string> = { enabled: 'enabled', tier: 'tier', model: 'model' }

const WORDS: Record<string, Command> = {
  '': { kind: 'status' },
  status: { kind: 'status' },
  reset: { kind: 'reset' },
  on: { kind: 'set', patch: { enabled: true } },
  off: { kind: 'set', patch: { enabled: false } },
  free: { kind: 'set', patch: { tier: 'free' } },
  paid: { kind: 'set', patch: { tier: 'paid' } },
}

/** Reads the argument of /gemini-advisor. */
export function parseCommand(args: string): Command {
  const [first = '', second, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (rest.length > 0) return { kind: 'error', text: USAGE }
  if (first === 'model') {
    if (second === undefined || !MODEL_ID.test(second)) return { kind: 'error', text: 'model takes a Gemini model id such as gemini-3.8-flash' }
    return { kind: 'set', patch: { model: second } }
  }
  const word = WORDS[first]
  return word !== undefined && second === undefined ? word : { kind: 'error', text: USAGE }
}

/** A stored value of the right type, or undefined so the plugin option applies. */
export function storedValue<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  const valid: Record<keyof Settings, (v: unknown) => boolean> = {
    enabled: v => typeof v === 'boolean',
    tier: v => v === 'free' || v === 'paid',
    model: v => typeof v === 'string' && MODEL_ID.test(v),
  }
  return valid[key](value) ? (value as Settings[K]) : undefined
}

export const FREE_WARNING =
  'free tier: Google may use the conversation sent to Gemini to improve its products, and human reviewers may read it (Gemini API Additional Terms). Use paid with a billing-enabled key to avoid this.'

/** The line /gemini-advisor prints for a change. */
export function changeText(patch: Patch): string {
  if (patch.enabled !== undefined) return patch.enabled ? 'on' : 'off: the model is told the advisor is off when it calls it'
  if (patch.tier !== undefined) return patch.tier === 'free' ? FREE_WARNING : 'paid tier'
  return `model ${patch.model ?? ''}; the model sees the new name from its next request`
}

/** The status of /gemini-advisor. */
export function statusText(s: Settings, hasKey: boolean, last: string | undefined): string {
  const key = hasKey ? 'key set' : 'no key: set GEMINI_API_KEY or the plugin option'
  const lines = [`${s.enabled ? 'on' : 'off'} · ${s.model} · ${s.tier} tier · ${key}`]
  if (last !== undefined) lines.push(`last: ${last}`)
  return lines.join('\n')
}
