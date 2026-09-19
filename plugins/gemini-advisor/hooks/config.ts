/** The plugin options with their defaults. */
import type { PluginOptions } from 'claude-code'

export type Config = { maxInputChars: number; maxOutputTokens: number }

export const DEFAULTS: Config = { maxInputChars: 2_000_000, maxOutputTokens: 8192 }

/** The plugin name gemini-core knows this mod by, and the model it uses until /gemini-core sets another. */
export const CONSUMER = 'gemini-advisor'
export const DEFAULT_MODEL = 'gemini-3.8-flash'

/**
 * No new Gemini attempt starts once this much has passed. The engine serves
 * the tool with a 60 s timeout (debug log), and one Gemini answer took 12 s
 * (measured), so the last attempt still fits.
 */
export const DEADLINE_MS = 40_000

function numberOption(options: PluginOptions, key: string, fallback: number, min: number, max: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** The plugin options, each out-of-range or missing one replaced by its default. */
export function configFrom(options: PluginOptions): Config {
  return {
    maxInputChars: numberOption(options, 'maxInputChars', DEFAULTS.maxInputChars, 10_000, 4_000_000),
    maxOutputTokens: numberOption(options, 'maxOutputTokens', DEFAULTS.maxOutputTokens, 256, 65_536),
  }
}
