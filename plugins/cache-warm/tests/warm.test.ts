import { describe, expect, test, tier } from 'claude-code/testing'

import {
  DEFAULT_WINDOW_MS,
  PING_AFTER_MS,
  card,
  fmtDuration,
  freshState,
  isColdWrite,
  isWarmPing,
  parseDuration,
  parseWarmArgs,
  resetForClear,
  seedFromResume,
  statusText,
} from '../hooks/warm.ts'

tier('user')

const MIN = 60 * 1000
const HOUR = 60 * MIN
const NOW = 1_000_000_000

const usage = (read: number, write: number) => ({ input_tokens: 2, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: write })

describe('durations', () => {
  test('parse hours, minutes and both', async () => {
    expect(parseDuration('6h')).toBe(6 * HOUR)
    expect(parseDuration('90m')).toBe(90 * MIN)
    expect(parseDuration('2h30m')).toBe(150 * MIN)
    expect(parseDuration('soon')).toBe(null)
    expect(parseDuration('')).toBe(null)
  })

  test('format minutes, hours and days', async () => {
    expect(fmtDuration(7 * MIN)).toBe('7m')
    expect(fmtDuration(150 * MIN)).toBe('2h30m')
    expect(fmtDuration((15 * 24 + 9) * HOUR)).toBe('15d 9h')
    expect(fmtDuration(-MIN)).toBe('0m')
  })
})

describe('parseWarmArgs', () => {
  test('a bare command arms the default window', async () => {
    expect(parseWarmArgs('')).toEqual({ kind: 'arm', window: DEFAULT_WINDOW_MS, every: PING_AFTER_MS })
  })

  test('a window, with or without an every period', async () => {
    expect(parseWarmArgs('90m')).toEqual({ kind: 'arm', window: 90 * MIN, every: PING_AFTER_MS })
    expect(parseWarmArgs(' 6h every 2m ')).toEqual({ kind: 'arm', window: 6 * HOUR, every: 2 * MIN })
  })

  test('the keywords', async () => {
    expect(parseWarmArgs('always')).toEqual({ kind: 'always' })
    expect(parseWarmArgs('off')).toEqual({ kind: 'off' })
    expect(parseWarmArgs('status')).toEqual({ kind: 'status' })
  })

  test('refuses what it cannot read instead of guessing', async () => {
    expect(parseWarmArgs('soon').kind).toBe('error')
    expect(parseWarmArgs('0m').kind).toBe('error')
    expect(parseWarmArgs('off now').kind).toBe('error')
    expect(parseWarmArgs('6h every 0m').kind).toBe('error')
    expect(parseWarmArgs('6h every').kind).toBe('error')
    expect(parseWarmArgs('6h sometimes 2m').kind).toBe('error')
  })
})

describe('cache checks', () => {
  test('a ping is warm when it read and wrote less than a tenth of the read', async () => {
    expect(isWarmPing(usage(200_000, 500))).toBe(true)
    expect(isWarmPing(usage(75_000, 70_000))).toBe(false)
    expect(isWarmPing(usage(0, 0))).toBe(false)
    expect(isWarmPing(usage(0, 180_000))).toBe(false)
  })

  test('a cold write re-writes at least half of a sizeable context', async () => {
    expect(isColdWrite(200_000, 200_502)).toBe(true)
    expect(isColdWrite(200_000, 2_000)).toBe(false)
    expect(isColdWrite(10_000, 10_000)).toBe(false)
  })
})

describe('resume and clear', () => {
  test('a cold resume seeds the state and returns the estimate line', async () => {
    const s = freshState()
    const line = seedFromResume(s, {
      source: 'resume', model: 'claude-fable-5-1', context_tokens: 396_113,
      seconds_since_last_response: 3 * 3600, prompt_cache_likely_expired: true, estimated_cache_write_usd: 7.92,
    }, NOW)
    expect(line).toBe('resuming cold. The first message re-writes 396,113 tokens, about $7.92.')
    expect(s.ctx).toBe(396_113)
    expect(s.lastRequestAt).toBe(NOW - 3 * HOUR)
    expect(s.model).toBe('claude-fable-5-1')
  })

  test('prices the resume from the table when the estimate is missing', async () => {
    const line = seedFromResume(freshState(), { source: 'fork', model: 'claude-opus-5', context_tokens: 100_000, prompt_cache_likely_expired: true }, NOW)
    expect(line).toMatch(/about \$1\.00\.$/)
  })

  test('stays quiet on a start, a warm resume and a small context', async () => {
    expect(seedFromResume(freshState(), { source: 'startup' }, NOW)).toBe(null)
    expect(seedFromResume(freshState(), { source: 'resume', context_tokens: 300_000, prompt_cache_likely_expired: false }, NOW)).toBe(null)
    expect(seedFromResume(freshState(), { source: 'resume', context_tokens: 20_000, prompt_cache_likely_expired: true }, NOW)).toBe(null)
  })

  test('/clear forgets the context, the clock, the tally and the timer', async () => {
    const s = freshState()
    s.ctx = 200_000
    s.lastRequestAt = NOW - 2 * HOUR
    s.coldWrites = [{ tokens: 200_000, usd: 4 }]
    s.lastPing = { read: 1, write: 0, usd: 0 }
    s.stopped = 'x'
    let cancelled = false
    s.pending = { cancel: () => { cancelled = true } }
    resetForClear(s)
    expect([s.ctx, s.lastRequestAt, s.coldWrites, s.lastPing, s.stopped, s.pending]).toEqual([0, 0, [], null, null, null])
    expect(cancelled).toBe(true)
  })
})

describe('text', () => {
  test('the status line is empty while off', async () => {
    expect(statusText(freshState(), NOW)).toBe(undefined)
  })

  test('the card names the always switch while off', async () => {
    const s = freshState()
    s.always = true
    expect(card(s, NOW)).toMatch(/keep warm   off until the next session start or \/clear, which arm 6h00m \(always\)/)
  })

  test('the card of a cold session', async () => {
    const s = freshState()
    s.model = 'claude-fable-5-1'
    s.ctx = 200_000
    s.lastRequestAt = NOW - 2 * HOUR
    const text = card(s, NOW)
    expect(text).toMatch(/state       COLD, last request 2h00m ago/)
    expect(text).toMatch(/cold cost   \$4\.00 to re-write it \(warm turn \$0\.05\)/)
    expect(text).toMatch(/session     0 cold writes paid, \$0\.00/)
  })
})
