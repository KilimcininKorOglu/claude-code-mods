/** The settings /gemini-compact changes, and the reading of its argument. */
import { MODEL_ID } from './gemini.ts'

export type Tier = 'free' | 'paid'

/** summary: Gemini summarizes the conversation; prune: Gemini decides on each old tool call. */
export type Mode = 'summary' | 'prune'

/** What the command can change; 0 in `atPercent` turns the automatic trigger off. */
export type Settings = { enabled: boolean; mode: Mode; tier: Tier; model: string; atPercent: number }

export type Patch = Partial<Settings>

export type Command =
  | { kind: 'status' }
  | { kind: 'reset' }
  | { kind: 'set'; patch: Patch }
  | { kind: 'error'; text: string }

export const USAGE = 'expects on, off, mode summary, mode prune, free, paid, model <id>, at <1-99>, at off, or reset'

/** The store key of each setting. */
export const STORE_KEYS: Record<keyof Settings, string> = {
  enabled: 'enabled',
  mode: 'mode',
  tier: 'tier',
  model: 'model',
  atPercent: 'atPercent',
}

function parseAt(value: string | undefined): Command {
  if (value === 'off') return { kind: 'set', patch: { atPercent: 0 } }
  const n = Number(value)
  if (value === undefined || !/^\d+$/.test(value) || n < 1 || n > 99) return { kind: 'error', text: 'at takes a whole percentage from 1 to 99, or off' }
  return { kind: 'set', patch: { atPercent: n } }
}

function parseModel(value: string | undefined): Command {
  if (value === undefined || !MODEL_ID.test(value)) return { kind: 'error', text: 'model takes a Gemini model id such as gemini-3.5-flash-lite' }
  return { kind: 'set', patch: { model: value } }
}

function parseMode(value: string | undefined): Command {
  if (value !== 'summary' && value !== 'prune') return { kind: 'error', text: 'mode takes summary or prune' }
  return { kind: 'set', patch: { mode: value } }
}

const WORDS: Record<string, Command> = {
  '': { kind: 'status' },
  status: { kind: 'status' },
  reset: { kind: 'reset' },
  on: { kind: 'set', patch: { enabled: true } },
  off: { kind: 'set', patch: { enabled: false } },
  free: { kind: 'set', patch: { tier: 'free' } },
  paid: { kind: 'set', patch: { tier: 'paid' } },
}

/** Reads the argument of /gemini-compact. */
export function parseCommand(args: string): Command {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [first = '', second, ...rest] = words
  if (rest.length > 0) return { kind: 'error', text: USAGE }
  if (first === 'at') return parseAt(second)
  if (first === 'model') return parseModel(second)
  if (first === 'mode') return parseMode(second)
  const word = WORDS[first]
  return word !== undefined && second === undefined ? word : { kind: 'error', text: USAGE }
}

/** A stored value of the right type, or undefined so the plugin option applies. */
export function storedValue<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  const valid: Record<keyof Settings, (v: unknown) => boolean> = {
    enabled: v => typeof v === 'boolean',
    mode: v => v === 'summary' || v === 'prune',
    tier: v => v === 'free' || v === 'paid',
    model: v => typeof v === 'string' && MODEL_ID.test(v),
    atPercent: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99,
  }
  return valid[key](value) ? (value as Settings[K]) : undefined
}

export const FREE_WARNING =
  'free tier: Google may use the conversation sent to Gemini to improve its products, and human reviewers may read it (Gemini API Additional Terms). Use paid with a billing-enabled key to avoid this.'

const MODE_TEXT: Record<Mode, string> = {
  summary: 'mode summary: Gemini summarizes the conversation and the newest messages stay verbatim',
  prune: 'mode prune: every message stays and Gemini keeps, truncates or drops each old tool call',
}

/** The line /gemini-compact prints for a change. */
export function changeText(patch: Patch): string {
  if (patch.enabled !== undefined) return patch.enabled ? 'on' : 'off: compaction uses the built-in summary'
  if (patch.mode !== undefined) return MODE_TEXT[patch.mode]
  if (patch.tier !== undefined) return patch.tier === 'free' ? FREE_WARNING : 'paid tier'
  if (patch.model !== undefined) return `model ${patch.model}`
  return patch.atPercent === 0 ? 'automatic compaction off; /compact and the engine\'s own compaction still use Gemini' : `compacts when the context passes ${patch.atPercent}%`
}

/** The status line of /gemini-compact. */
export function statusText(s: Settings, hasKey: boolean, last: string | undefined): string {
  const at = s.atPercent === 0 ? 'automatic off' : `automatic at ${s.atPercent}%`
  const key = hasKey ? 'key set' : 'no key: set GEMINI_API_KEY or the plugin option'
  const lines = [`${s.enabled ? 'on' : 'off'} · ${s.mode} · ${s.model} · ${at} · ${s.tier} tier · ${key}`]
  if (last !== undefined) lines.push(`last: ${last}`)
  return lines.join('\n')
}
