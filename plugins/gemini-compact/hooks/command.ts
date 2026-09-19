/** The settings /gemini-compact changes, and the reading of its argument. */
import type { EngineInterface } from 'claude-code'

/** What gemini-core says this mod runs with. */
export type GeminiSettings = Awaited<ReturnType<EngineInterface['gemini']['settings']>>

/** summary: Gemini summarizes the conversation; prune: Gemini decides on each old tool call. */
export type Mode = 'summary' | 'prune'

/** What the command can change; 0 in `atPercent` turns the automatic trigger off. */
export type Settings = { enabled: boolean; mode: Mode; atPercent: number }

export type Patch = Partial<Settings>

export type Command =
  | { kind: 'status' }
  | { kind: 'reset' }
  | { kind: 'set'; patch: Patch }
  | { kind: 'error'; text: string }

export const USAGE = 'expects on, off, mode summary, mode prune, at <1-99>, at off, or reset; /gemini-core sets the model, the thinking level and the tier'

/** The store key of each setting. */
export const STORE_KEYS: Record<keyof Settings, string> = {
  enabled: 'enabled',
  mode: 'mode',
  atPercent: 'atPercent',
}

function parseAt(value: string | undefined): Command {
  if (value === 'off') return { kind: 'set', patch: { atPercent: 0 } }
  const n = Number(value)
  if (value === undefined || !/^\d+$/.test(value) || n < 1 || n > 99) return { kind: 'error', text: 'at takes a whole percentage from 1 to 99, or off' }
  return { kind: 'set', patch: { atPercent: n } }
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
}

/** Reads the argument of /gemini-compact. */
export function parseCommand(args: string): Command {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [first = '', second, ...rest] = words
  if (rest.length > 0) return { kind: 'error', text: USAGE }
  if (first === 'at') return parseAt(second)
  if (first === 'mode') return parseMode(second)
  const word = WORDS[first]
  return word !== undefined && second === undefined ? word : { kind: 'error', text: USAGE }
}

/** A stored value of the right type, or undefined so the plugin option applies. */
export function storedValue<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  const valid: Record<keyof Settings, (v: unknown) => boolean> = {
    enabled: v => typeof v === 'boolean',
    mode: v => v === 'summary' || v === 'prune',
    atPercent: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99,
  }
  return valid[key](value) ? (value as Settings[K]) : undefined
}

const MODE_TEXT: Record<Mode, string> = {
  summary: 'mode summary: Gemini summarizes the conversation and the newest messages stay verbatim',
  prune: 'mode prune: every message stays and Gemini keeps, truncates or drops each old tool call',
}

/** What `on` answers while gemini-core has no key; nothing is stored. */
export const NO_KEY_ON = 'still off: gemini-core has no Gemini key. Set GEMINI_API_KEY or the gemini-core apiKey option, restart Claude Code, then run /gemini-compact on'

/** What `reset` answers: the plugin options, and off until it is turned on. */
export const RESET_TEXT = 'settings reset to the plugin options; off until /gemini-compact on'

/** The line /gemini-compact prints for a change. */
export function changeText(patch: Patch): string {
  if (patch.enabled !== undefined) return patch.enabled ? 'on' : 'off: compaction uses the built-in summary'
  if (patch.mode !== undefined) return MODE_TEXT[patch.mode]
  return patch.atPercent === 0 ? 'automatic compaction off; /compact and the engine\'s own compaction still use Gemini' : `compacts when the context passes ${patch.atPercent}%`
}

/** The status line of /gemini-compact, with what gemini-core says it runs with. */
export function statusText(s: Settings, g: GeminiSettings, last: string | undefined): string {
  const at = s.atPercent === 0 ? 'automatic off' : `automatic at ${s.atPercent}%`
  const key = g.hasKey ? 'key set' : 'no key: set GEMINI_API_KEY or the gemini-core apiKey option'
  const lines = [`${s.enabled ? 'on' : 'off'} · ${s.mode} · ${g.model} · thinking ${g.thinking ?? 'model default'} · ${at} · ${g.tier} tier · ${key}`]
  if (!s.enabled) lines.push('off until /gemini-compact on; every compaction uses the built-in summary; the model, the thinking level and the tier are /gemini-core settings')
  if (last !== undefined) lines.push(`last: ${last}`)
  return lines.join('\n')
}
