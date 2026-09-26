/** The plugin option and the fixed limits of one council run. */
import type { PluginOptions } from 'claude-code'

export type Config = { maxInputChars: number }

/**
 * 400,000 characters of rendered conversation were 163,828 input tokens on Opus 5.5, Sonnet 5 and
 * Fable 5.1, 128,018 on Haiku 4.5 and 120,057 on gemini-3.8-flash (measured on 2.1.283).
 */
export const DEFAULTS: Config = { maxInputChars: 400_000 }

/** Haiku 4.5 has a 200k token window; 560,000 characters are about 180k of its tokens. */
export const HAIKU_MAX_CHARS = 560_000

/** A member that has not answered by then is counted as failed; it guards against a hung request only. */
export const MEMBER_MS = 300_000

/** The longest answer of a member or the chair, thinking included. */
export const MAX_TOKENS = 8192

export function configFrom(options: PluginOptions): Config {
  const value = options.maxInputChars
  const ok = typeof value === 'number' && Number.isInteger(value) && value >= 20_000 && value <= 2_000_000
  return { maxInputChars: ok ? value : DEFAULTS.maxInputChars }
}
