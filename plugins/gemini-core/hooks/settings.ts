/** The settings /gemini-core changes, their store keys, and the lines it prints. */
import type { GeminiChange, GeminiThinking, GeminiTier } from '../types/index.d.ts'
import { MODEL_ID } from './api.ts'

export const THINKING: readonly GeminiThinking[] = ['minimal', 'low', 'medium', 'high']

export function isThinking(value: unknown): value is GeminiThinking {
  return THINKING.some(t => t === value)
}

export function isTier(value: unknown): value is GeminiTier {
  return value === 'free' || value === 'paid'
}

/** Store keys: the tier, the enrolled mods, and each mod's model and thinking level. */
export const KEYS = {
  tier: 'tier',
  consumers: 'consumers',
  model: (consumer: string) => `model:${consumer}`,
  thinking: (consumer: string) => `thinking:${consumer}`,
}

/** The enrolled mods and their default models, from the store. */
export function consumersOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string' && MODEL_ID.test(e[1])))
}

/** A mod named in full (`gemini-review`) or without the `gemini-` prefix (`review`). */
export function resolveConsumer(name: string, enrolled: readonly string[]): string | undefined {
  return enrolled.find(c => c === name || c === `gemini-${name}`)
}

export type Command = { kind: 'status' } | { kind: 'change'; change: GeminiChange } | { kind: 'error'; text: string }

export const USAGE = 'expects free, paid, model <mod> <id>, thinking <mod> <minimal|low|medium|high|default>, or reset'

function modelCommand(consumer: string | undefined, id: string | undefined): Command {
  if (consumer === undefined || id === undefined || !MODEL_ID.test(id)) return { kind: 'error', text: 'model takes a mod and a Gemini model id, for example: model review gemini-3.8-flash' }
  return { kind: 'change', change: { consumer, model: id } }
}

function thinkingCommand(consumer: string | undefined, level: string | undefined): Command {
  if (consumer === undefined || level === undefined) return { kind: 'error', text: 'thinking takes a mod and a level, for example: thinking review low' }
  if (level === 'default') return { kind: 'change', change: { consumer, thinking: null } }
  return isThinking(level) ? { kind: 'change', change: { consumer, thinking: level } } : { kind: 'error', text: `thinking level ${level} is not one of ${THINKING.join(', ')}, default` }
}

const WORDS: Record<string, Command> = {
  '': { kind: 'status' },
  status: { kind: 'status' },
  free: { kind: 'change', change: { tier: 'free' } },
  paid: { kind: 'change', change: { tier: 'paid' } },
  reset: { kind: 'change', change: { reset: true } },
}

/** Reads the argument of /gemini-core; the mod name is taken as typed and resolved by `configure`. */
export function parseCommand(args: string): Command {
  const [first = '', second, third, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (rest.length > 0) return { kind: 'error', text: USAGE }
  if (first === 'model') return modelCommand(second, third)
  if (first === 'thinking') return thinkingCommand(second, third)
  const word = WORDS[first]
  return word !== undefined && second === undefined ? word : { kind: 'error', text: USAGE }
}

export const FREE_WARNING =
  'free tier: Google may use what the Gemini mods send (the conversation, tool outputs, diffs) to improve its products, and human reviewers may read it (Gemini API Additional Terms). Use paid with a billing-enabled key to avoid this.'

/** One mod's line in the status. */
export type ConsumerLine = { consumer: string; model: string; thinking?: GeminiThinking }

/** The status of /gemini-core. */
export function statusText(tier: GeminiTier, keys: number, lines: readonly ConsumerLine[]): string {
  const key = keys === 0 ? 'no key: set GEMINI_API_KEY or the gemini-core apiKey option' : keys === 1 ? 'key set' : `${keys} keys, tried in turn`
  const mods = lines.map(l => `${l.consumer}: ${l.model} · thinking ${l.thinking ?? 'model default'}`)
  return [`${tier} tier · ${key}`, ...(mods.length === 0 ? ['no Gemini mod has enrolled yet'] : mods)].join('\n')
}
