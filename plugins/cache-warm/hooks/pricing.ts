/** List prices in dollars per million tokens. */
export interface Price {
  /** Cache hits and refreshes. */
  read: number
  /** 1-hour cache writes; the base input rate is half of it. */
  write: number
  output: number
}

/** The token counts an API response bills. */
export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/**
 * Model pricing from platform.claude.com/docs/en/about-claude/pricing, read in
 * September 2026. A model id takes the first row whose family it contains, so
 * the specific families come before the general ones.
 */
const PRICES: ReadonlyArray<readonly [family: string, price: Price]> = [
  ['fable-5-1', { read: 0.25, write: 20, output: 50 }],
  ['mythos-5-1', { read: 0.25, write: 20, output: 50 }],
  ['fable-5', { read: 1, write: 20, output: 50 }],
  ['mythos-5', { read: 1, write: 20, output: 50 }],
  ['opus-5', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-5', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-6', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-7', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-8', { read: 0.5, write: 10, output: 25 }],
  ['opus-4', { read: 1.5, write: 30, output: 75 }],
  ['sonnet-5', { read: 0.2, write: 4, output: 10 }],
  ['sonnet', { read: 0.3, write: 6, output: 15 }],
  ['haiku-4-5', { read: 0.1, write: 2, output: 5 }],
  ['haiku', { read: 0.08, write: 1.6, output: 4 }],
]

const MTOK = 1e6

export function priceOf(model: string | null): Price | null {
  const id = (model ?? '').toLowerCase().replace(/[\s.]+/g, '-')
  return PRICES.find(([family]) => id.includes(family))?.[1] ?? null
}

/** What writing this many tokens to the 1-hour cache costs. */
export function writeUsd(tokens: number, price: Price | null): number | null {
  return price ? tokens * price.write / MTOK : null
}

/** What reading this many tokens from the cache costs. */
export function readUsd(tokens: number, price: Price | null): number | null {
  return price ? tokens * price.read / MTOK : null
}

/** Everything one response bills: the cache read, the cache write, the uncached input at the base rate and the output. */
export function responseUsd(u: Usage, price: Price): number {
  const base = price.write / 2
  return (u.cache_read_input_tokens * price.read + u.cache_creation_input_tokens * price.write +
    u.input_tokens * base + u.output_tokens * price.output) / MTOK
}

/** How many reads of a context cost as much as one write of it; the upper bound of pings worth sending. */
export function breakEvenPings(price: Price | null): number | null {
  return price ? Math.floor(price.write / price.read) : null
}
