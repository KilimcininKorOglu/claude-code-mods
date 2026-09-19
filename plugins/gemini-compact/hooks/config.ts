/** The plugin options with their defaults, and the line a compaction reports. */
import type { PluginOptions } from 'claude-code'
import { storedValue, type Settings } from './command.ts'
import type { Action } from './prune.ts'

export type Config = Settings & {
  apiKey?: string
  keepRecent: number
  minReduction: number
  headChars: number
  maxInputChars: number
  summaryMaxInputChars: number
  summaryMaxOutputTokens: number
}

export const DEFAULTS: Omit<Config, 'apiKey'> = {
  enabled: true,
  mode: 'summary',
  tier: 'free',
  model: 'gemini-3.5-flash-lite',
  atPercent: 60,
  keepRecent: 6,
  minReduction: 0.25,
  headChars: 300,
  maxInputChars: 400_000,
  summaryMaxInputChars: 2_000_000,
  summaryMaxOutputTokens: 32_768,
}

function numberOption(options: PluginOptions, key: string, fallback: number, min: number, max: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

/** The plugin options, each out-of-range or missing one replaced by its default. */
export function configFrom(options: PluginOptions): Config {
  const apiKey = typeof options.apiKey === 'string' && options.apiKey.trim() !== '' ? options.apiKey.trim() : undefined
  return {
    enabled: DEFAULTS.enabled,
    mode: storedValue('mode', options.mode) ?? DEFAULTS.mode,
    tier: storedValue('tier', options.tier) ?? DEFAULTS.tier,
    model: storedValue('model', options.model) ?? DEFAULTS.model,
    atPercent: numberOption(options, 'compactAtPercent', DEFAULTS.atPercent, 0, 99),
    keepRecent: numberOption(options, 'keepRecent', DEFAULTS.keepRecent, 0, 1000),
    minReduction: numberOption(options, 'minReduction', DEFAULTS.minReduction, 0, 1),
    headChars: numberOption(options, 'headChars', DEFAULTS.headChars, 0, 100_000),
    maxInputChars: numberOption(options, 'maxInputChars', DEFAULTS.maxInputChars, 10_000, 4_000_000),
    summaryMaxInputChars: numberOption(options, 'summaryMaxInputChars', DEFAULTS.summaryMaxInputChars, 10_000, 4_000_000),
    summaryMaxOutputTokens: DEFAULTS.summaryMaxOutputTokens,
    ...(apiKey === undefined ? {} : { apiKey }),
  }
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export type Tally = { kept: number; total: number; ratio: number; actions: Iterable<Action>; inputTokens: number; outputTokens: number }

/** `kept 41/58 messages · 52% smaller · 18 dropped, 9 truncated · 31k in, 1k out` */
export function outcomeText(t: Tally): string {
  const all = [...t.actions]
  const dropped = all.filter(a => a === 'drop').length
  const cut = all.filter(a => a === 'truncate').length
  return `kept ${t.kept}/${t.total} messages · ${Math.round(t.ratio * 100)}% smaller · ${dropped} dropped, ${cut} truncated · ${tokens(t.inputTokens)} in, ${tokens(t.outputTokens)} out`
}

export type SummaryTally = Omit<Tally, 'actions'>

/** `summary: 58 → 7 messages · 91% smaller · 312k in, 5k out` */
export function summaryOutcomeText(t: SummaryTally): string {
  return `summary: ${t.total} → ${t.kept} messages · ${Math.round(t.ratio * 100)}% smaller · ${tokens(t.inputTokens)} in, ${tokens(t.outputTokens)} out`
}
