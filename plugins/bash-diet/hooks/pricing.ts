/**
 * What the tokens a filter kept out of the context would have cost. A result enters the context once,
 * written to the prompt cache, and every later request of the session reads it back from the cache.
 */

import { fmtTokens } from './text.ts'

/** List prices in dollars per million tokens: the cache read, and the 1-hour cache write. */
export type Price = { read: number; write: number }

/**
 * Model pricing from platform.claude.com/docs/en/about-claude/pricing, read in September 2026. A model
 * id takes the first row whose family it contains, so the specific families come before the general ones.
 */
const PRICES: ReadonlyArray<readonly [family: string, price: Price]> = [
  ['fable-5-1', { read: 0.25, write: 20 }],
  ['mythos-5-1', { read: 0.25, write: 20 }],
  ['fable-5', { read: 1, write: 20 }],
  ['mythos-5', { read: 1, write: 20 }],
  ['opus-5-5', { read: 0.2, write: 8 }],
  ['opus-5', { read: 0.5, write: 10 }],
  ['opus-4-5', { read: 0.5, write: 10 }],
  ['opus-4-6', { read: 0.5, write: 10 }],
  ['opus-4-7', { read: 0.5, write: 10 }],
  ['opus-4-8', { read: 0.5, write: 10 }],
  ['opus-4', { read: 1.5, write: 30 }],
  ['sonnet-5', { read: 0.2, write: 4 }],
  ['sonnet', { read: 0.3, write: 6 }],
  ['haiku-4-5', { read: 0.1, write: 2 }],
  ['haiku', { read: 0.08, write: 1.6 }],
]

const MTOK = 1e6

export function priceOf(model: string): Price | undefined {
  const id = model.toLowerCase().replace(/[\s.]+/g, '-')
  return PRICES.find(([family]) => id.includes(family))?.[1]
}

const usd = (n: number): string => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

/** `/bash-diet cost`: the session's spend, and what the tokens kept out would have added. */
export function costText(model: string, savedTokens: number, sessionUsd: number | undefined): string {
  const spent = sessionUsd === undefined ? 'no cost ledger in this host' : `${usd(sessionUsd)} so far`
  const head = `this session (${model}): ${spent}`
  if (savedTokens === 0) return `${head}\nno Bash result shrunk yet`
  const price = priceOf(model)
  const kept = `~${fmtTokens(savedTokens)} tokens kept out of the context`
  if (price === undefined) return `${head}\n${kept}; no price is known for ${model}`
  return [
    head,
    `${kept}: ${usd((savedTokens * price.write) / MTOK)} saved on the cache write when they would have entered,`,
    `and ${usd((savedTokens * price.read) / MTOK)} on every later request that reads the context back from the cache`,
  ].join('\n')
}
