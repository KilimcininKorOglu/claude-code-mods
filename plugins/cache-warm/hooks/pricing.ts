/** List prices in dollars per million tokens. */
export interface Price {
  /** Cache hits and refreshes. */
  read: number
  /** 1-hour cache writes; the base input rate is half of it. */
  write: number
  output: number
  /** The rates of a request whose prompt (input, cache reads and cache writes) is over `LONG_PROMPT` tokens. */
  long?: Omit<Price, 'long'>
}

/** Haiku 5.5 bills a whole request at its higher rates once the prompt passes this many tokens. */
export const LONG_PROMPT = 100_000

/** The token counts an API response bills. */
export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/**
 * Model pricing from platform.claude.com/docs/en/about-claude/pricing, read in
 * November 2026. A model id takes the first row whose family it contains, so
 * the specific families come before the general ones.
 */
const PRICES: ReadonlyArray<readonly [family: string, price: Price]> = [
  ['fable-5-2', { read: 0.2, write: 16, output: 40 }],
  ['mythos-5-2', { read: 0.2, write: 16, output: 40 }],
  ['fable-5-1', { read: 0.25, write: 20, output: 50 }],
  ['mythos-5-1', { read: 0.25, write: 20, output: 50 }],
  ['fable-5', { read: 1, write: 20, output: 50 }],
  ['mythos-5', { read: 1, write: 20, output: 50 }],
  ['opus-5-5', { read: 0.2, write: 8, output: 20 }],
  ['opus-5', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-5', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-6', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-7', { read: 0.5, write: 10, output: 25 }],
  ['opus-4-8', { read: 0.5, write: 10, output: 25 }],
  ['opus-4', { read: 1.5, write: 30, output: 75 }],
  ['sonnet-5-5', { read: 0.1, write: 4, output: 10 }],
  ['sonnet-5', { read: 0.2, write: 4, output: 10 }],
  ['sonnet', { read: 0.3, write: 6, output: 15 }],
  ['haiku-5-5', { read: 0.01, write: 0.2, output: 0.5, long: { read: 0.05, write: 1, output: 2.5 } }],
  ['haiku-4-5', { read: 0.1, write: 2, output: 5 }],
  ['haiku', { read: 0.08, write: 1.6, output: 4 }],
]

/**
 * Fast mode rates, from the same page: the fast base input and output, with the cache multipliers
 * applied on top of the fast base input (2x for the 1-hour write; read 0.025x on Fable and Mythos
 * 5.2, 0.05x on Opus 5.5, 0.1x on the others). Only these models take fast mode; any other model
 * bills its standard rates.
 */
const FAST_PRICES: ReadonlyArray<readonly [family: string, price: Price]> = [
  ['fable-5-2', { read: 0.4, write: 32, output: 80 }],
  ['mythos-5-2', { read: 0.4, write: 32, output: 80 }],
  ['opus-5-5', { read: 0.4, write: 16, output: 40 }],
  ['opus-5', { read: 1, write: 20, output: 50 }],
  ['opus-4-8', { read: 1, write: 20, output: 50 }],
]

const MTOK = 1e6

function rowOf(rows: ReadonlyArray<readonly [string, Price]>, id: string): Price | undefined {
  return rows.find(([family]) => id.includes(family))?.[1]
}

const idOf = (model: string | null): string => (model ?? '').toLowerCase().replace(/[\s.]+/g, '-')

/** Whether fast mode bills this model at its own rates. */
export function hasFastRate(model: string | null): boolean {
  return rowOf(FAST_PRICES, idOf(model)) !== undefined
}

export function priceOf(model: string | null, fast = false): Price | null {
  const id = idOf(model)
  return (fast ? rowOf(FAST_PRICES, id) : undefined) ?? rowOf(PRICES, id) ?? null
}

/** The rates a request with a prompt of this many tokens pays: the higher ones past `LONG_PROMPT` where the model has them. */
export function ratesFor(price: Price, promptTokens: number): Omit<Price, 'long'> {
  return promptTokens > LONG_PROMPT && price.long ? price.long : price
}

/** What writing this many tokens to the 1-hour cache costs, in a request whose prompt is `prompt` tokens (the written ones by default). */
export function writeUsd(tokens: number, price: Price | null, prompt = tokens): number | null {
  return price ? tokens * ratesFor(price, prompt).write / MTOK : null
}

/** What reading a context of this many tokens from the cache costs. */
export function readUsd(tokens: number, price: Price | null): number | null {
  return price ? tokens * ratesFor(price, tokens).read / MTOK : null
}

/**
 * Everything a response bills: the cache read, the cache write, the uncached input at the base rate
 * and the output. `prompt` is one request's prompt; it defaults to the usage's own input, which
 * overstates it for a turn's usage summed over several requests.
 */
export function responseUsd(u: Usage, price: Price, prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens): number {
  const rates = ratesFor(price, prompt)
  const base = rates.write / 2
  return (u.cache_read_input_tokens * rates.read + u.cache_creation_input_tokens * rates.write +
    u.input_tokens * base + u.output_tokens * rates.output) / MTOK
}

/** How many reads of a context cost as much as one write of it; the upper bound of pings worth sending. */
export function breakEvenPings(price: Price | null): number | null {
  return price ? Math.floor(price.write / price.read) : null
}
