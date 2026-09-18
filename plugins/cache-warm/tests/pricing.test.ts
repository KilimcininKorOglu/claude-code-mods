import { describe, expect, test, tier } from 'claude-code/testing'

import { breakEvenPings, priceOf, readUsd, responseUsd, writeUsd } from '../hooks/pricing.ts'

tier('user')

describe('priceOf', () => {
  test('takes the most specific family a model id contains', async () => {
    expect(priceOf('claude-fable-5-1')).toEqual({ read: 0.25, write: 20, output: 50 })
    expect(priceOf('claude-fable-5')).toEqual({ read: 1, write: 20, output: 50 })
    expect(priceOf('claude-opus-5[1m]')).toEqual({ read: 0.5, write: 10, output: 25 })
    expect(priceOf('claude-opus-4-8')).toEqual({ read: 0.5, write: 10, output: 25 })
    expect(priceOf('claude-sonnet-5')).toEqual({ read: 0.2, write: 4, output: 10 })
    expect(priceOf('claude-sonnet-4-6')).toEqual({ read: 0.3, write: 6, output: 15 })
    expect(priceOf('claude-haiku-4-5-20251001')).toEqual({ read: 0.1, write: 2, output: 5 })
  })

  test('prices Opus 4 and 4.1 at their own, higher rates', async () => {
    expect(priceOf('claude-opus-4-1-20250805')).toEqual({ read: 1.5, write: 30, output: 75 })
    expect(priceOf('claude-opus-4-20250514')).toEqual({ read: 1.5, write: 30, output: 75 })
  })

  test('prices Haiku 3.5 below Haiku 4.5', async () => {
    expect(priceOf('claude-3-5-haiku-20241022')).toEqual({ read: 0.08, write: 1.6, output: 4 })
  })

  test('reads a display name with dots and spaces', async () => {
    expect(priceOf('Claude Fable 5.1')).toEqual({ read: 0.25, write: 20, output: 50 })
  })

  test('knows nothing of an unknown or missing model', async () => {
    expect(priceOf('gpt-9')).toBe(null)
    expect(priceOf(null)).toBe(null)
  })
})

describe('costs', () => {
  const fable = { read: 0.25, write: 20, output: 50 }

  test('a write and a read of a context', async () => {
    expect(writeUsd(200_000, fable)).toBe(4)
    expect(readUsd(200_000, fable)).toBe(0.05)
    expect(writeUsd(200_000, null)).toBe(null)
  })

  test('a response bills the read, the write, the uncached input at half the write rate, and the output', async () => {
    const usd = responseUsd({ cache_read_input_tokens: 200_000, cache_creation_input_tokens: 1_000, input_tokens: 1_000, output_tokens: 1_000 }, fable)
    // 0.05 read + 0.02 write + 0.01 input + 0.05 output, compared in micro-dollars.
    expect(Math.round(usd * 1e6)).toBe(130_000)
  })

  test('the break-even is the write rate over the read rate', async () => {
    expect(breakEvenPings(fable)).toBe(80)
    expect(breakEvenPings({ read: 0.2, write: 4, output: 10 })).toBe(20)
    expect(breakEvenPings(null)).toBe(null)
  })
})
