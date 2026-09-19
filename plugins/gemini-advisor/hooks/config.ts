/** The plugin options with their defaults. */
import type { PluginOptions } from 'claude-code'
import { storedValue, type Settings } from './command.ts'

export type Config = Settings & { apiKey?: string; maxInputChars: number; maxOutputTokens: number }

export const DEFAULTS: Omit<Config, 'apiKey'> = {
  enabled: true,
  tier: 'free',
  model: 'gemini-3.8-flash',
  maxInputChars: 2_000_000,
  maxOutputTokens: 8192,
}

function numberOption(options: PluginOptions, key: string, fallback: number, min: number, max: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** The plugin options, each out-of-range or missing one replaced by its default. */
export function configFrom(options: PluginOptions): Config {
  const apiKey = typeof options.apiKey === 'string' && options.apiKey.trim() !== '' ? options.apiKey.trim() : undefined
  return {
    enabled: DEFAULTS.enabled,
    tier: storedValue('tier', options.tier) ?? DEFAULTS.tier,
    model: storedValue('model', options.model) ?? DEFAULTS.model,
    maxInputChars: numberOption(options, 'maxInputChars', DEFAULTS.maxInputChars, 10_000, 4_000_000),
    maxOutputTokens: numberOption(options, 'maxOutputTokens', DEFAULTS.maxOutputTokens, 256, 65_536),
    ...(apiKey === undefined ? {} : { apiKey }),
  }
}
