/** The plugin options with their defaults. */
import type { PluginOptions } from 'claude-code'

export type Config = { maxInputChars: number }

export const DEFAULTS: Config = { maxInputChars: 2_000_000 }

/** The plugin name gemini-core knows this mod by, and the model it uses until /gemini-core sets another. */
export const CONSUMER = 'gemini-review'
export const DEFAULT_MODEL = 'gemini-3.8-flash'

/** No new Gemini attempt starts once this much has passed; the Bash hook ran 42.5 s without a limit (measured). */
export const DEADLINE_MS = 60_000

function numberOption(options: PluginOptions, key: string, fallback: number, min: number, max: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** The plugin options, each out-of-range or missing one replaced by its default. */
export function configFrom(options: PluginOptions): Config {
  return { maxInputChars: numberOption(options, 'maxInputChars', DEFAULTS.maxInputChars, 10_000, 4_000_000) }
}
