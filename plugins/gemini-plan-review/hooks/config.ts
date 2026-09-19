/** The plugin options with their defaults. */
import type { PluginOptions } from 'claude-code'

export type Config = { maxInputChars: number }

export const DEFAULTS: Config = { maxInputChars: 2_000_000 }

/** The plugin name gemini-core knows this mod by, and the model it uses until /gemini-core sets another. */
export const CONSUMER = 'gemini-plan-review'
export const DEFAULT_MODEL = 'gemini-3.8-flash'

/** No new Gemini attempt starts once this much has passed. */
export const DEADLINE_MS = 50_000

/** A plan is sent back to the model at most this many times before it reaches the user. */
export const MAX_ROUNDS = 2

function numberOption(options: PluginOptions, key: string, fallback: number, min: number, max: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** The plugin options, each out-of-range or missing one replaced by its default. */
export function configFrom(options: PluginOptions): Config {
  return { maxInputChars: numberOption(options, 'maxInputChars', DEFAULTS.maxInputChars, 10_000, 4_000_000) }
}
