import { describe, expect, test, tier } from 'claude-code/testing'

import { breakEvenPings, hasFastRate, priceOf, readUsd, responseUsd, writeUsd } from '../hooks/pricing'

tier('user')

describe('priceOf', () => {
  test('takes the most specific family a model id contains', async () => {
    expect(priceOf('claude-fable-5-1')).toEqual({ read: 0.25, write: 20, output: 50 })
    expect(priceOf('claude-fable-5')).toEqual({ read: 1, write: 20, output: 50 })
    expect(priceOf('claude-opus-5[1m]')).toEqual({ read: 0.5, write: 10, output: 25 })
    expect(priceOf('claude-opus-4-8')).toEqual({ read: 0.5, write: 10, output: 25 })
    expect(priceOf('claude-sonnet-5')).toEqual({ read: 0.2, write: 4, output: 10 })
    expect(priceOf('claude-sonnet-5-5[1m]')).toEqual({ read: 0.1, write: 4, output: 10 })
    expect(priceOf('claude-sonnet-4-6')).toEqual({ read: 0.3, write: 6, output: 15 })
    expect(priceOf('claude-haiku-4-5-20251001')).toEqual({ read: 0.1, write: 2, output: 5 })
  })

  test('each model id the transcripts of November 2026 carry takes its own row, never a general one', async () => {
    // claude-fable-5-2 once fell to the fable-5 row (read 1, five times its price) and claude-haiku-5-5 to the Haiku 3.5 row.
    expect(priceOf('claude-fable-5-2')).toEqual({ read: 0.2, write: 16, output: 40 })
    expect(priceOf('claude-fable-5-2[1m]', true)).toEqual({ read: 0.4, write: 32, output: 80 })
    expect(priceOf('claude-haiku-5-5')).toEqual({ read: 0.01, write: 0.2, output: 0.5, long: { read: 0.05, write: 1, output: 2.5 } })
    expect(priceOf('claude-sonnet-5-5')).toEqual({ read: 0.1, write: 4, output: 10 })
    expect(priceOf('claude-opus-5-5')).toEqual({ read: 0.2, write: 8, output: 20 })
    expect(priceOf('glm-5.3-flash')).toBe(null)
  })

  test('a Haiku 5.5 request over 100,000 prompt tokens pays the higher rates on all of it, and one request decides it', async () => {
    const haiku = priceOf('claude-haiku-5-5')
    const usd = (n: number | null): string => (n ?? NaN).toFixed(6)
    expect(usd(readUsd(100_000, haiku))).toBe('0.001000')
    expect(usd(readUsd(200_000, haiku))).toBe('0.010000')
    expect(usd(writeUsd(1_000, haiku, 150_000))).toBe('0.001000')
    expect(usd(writeUsd(1_000, haiku))).toBe('0.000200')
    const usage = { input_tokens: 1_000, output_tokens: 1_000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 }
    // A turn's usage summed over ten requests of 21k tokens is no 201k prompt: each request is priced on its own.
    expect(usd(responseUsd({ ...usage, cache_read_input_tokens: 200_000 }, haiku!, 21_000))).toBe('0.002600')
    expect(usd(responseUsd({ ...usage, cache_read_input_tokens: 200_000 }, haiku!))).toBe('0.013000')
    expect(usd(responseUsd(usage, haiku!))).toBe('0.000800')
  })

  test('prices Opus 5.5 below Opus 5, not at the Opus 5 row its id also contains', async () => {
    expect(priceOf('claude-opus-5-5[1m]')).toEqual({ read: 0.2, write: 8, output: 20 })
    expect(priceOf('Claude Opus 5.5')).toEqual({ read: 0.2, write: 8, output: 20 })
    expect(breakEvenPings(priceOf('claude-opus-5-5'))).toBe(40)
  })

  test('fast mode bills Opus 5.5, Opus 5 and Opus 4.8 at the fast base rates with the cache multipliers on top', async () => {
    expect(priceOf('claude-opus-5-5[1m]', true)).toEqual({ read: 0.4, write: 16, output: 40 })
    expect(priceOf('claude-opus-5', true)).toEqual({ read: 1, write: 20, output: 50 })
    expect(priceOf('claude-opus-4-8', true)).toEqual({ read: 1, write: 20, output: 50 })
    expect([hasFastRate('claude-opus-5-5'), hasFastRate('claude-opus-4-8'), hasFastRate('claude-opus-4-7')]).toEqual([true, true, false])
  })

  test('fast mode leaves a model without fast rates at its standard rates', async () => {
    expect(priceOf('claude-opus-4-6', true)).toEqual({ read: 0.5, write: 10, output: 25 })
    expect(priceOf('claude-sonnet-5', true)).toEqual({ read: 0.2, write: 4, output: 10 })
    expect(priceOf('claude-sonnet-5-5', true)).toEqual({ read: 0.1, write: 4, output: 10 })
    expect(priceOf('gpt-9', true)).toBe(null)
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
