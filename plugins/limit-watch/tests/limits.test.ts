import { describe, expect, test, tier } from 'claude-code/testing'
import type { SessionRateLimit } from 'claude-code'
import {
  barCells,
  durationText,
  forecast,
  markWarned,
  mergeWarned,
  limitPace,
  newThresholds,
  pace,
  record,
  statusLine,
  type Tracks,
} from '../hooks/limits.ts'

tier('user')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const T0 = Date.parse('2026-09-18T12:00:00Z')
const RESET = '2026-09-18T15:00:00Z'

const fiveHour = (percentUsed: number, resetsAt: string | undefined = RESET): SessionRateLimit => ({
  kind: 'five_hour',
  percentUsed,
  resetsAt,
})

/** Records one reading of the 5-hour limit per entry, `[minutes after T0, percent]`. */
function readings(points: readonly [number, number][], resetsAt: string | undefined = RESET): Tracks {
  let tracks: Tracks = {}
  for (const [minutes, percent] of points) tracks = record(tracks, [fiveHour(percent, resetsAt)], T0 + minutes * MINUTE)
  return tracks
}

describe('pace', () => {
  test('measures until the samples span 10 minutes of the 5-hour limit', async () => {
    const tracks = readings([
      [0, 10],
      [5, 11],
    ])
    expect(pace(tracks.five_hour, 'five_hour', T0 + 5 * MINUTE)).toEqual({ missing: 5 * MINUTE })
  })

  test('reads percent per hour from the first and last sample of the lookback', async () => {
    const tracks = readings([
      [0, 10],
      [30, 15],
    ])
    expect(pace(tracks.five_hour, 'five_hour', T0 + 30 * MINUTE)).toEqual({ perHour: 10, span: 30 * MINUTE })
  })

  test('fits a line through every sample, so a late jump of the percentage does not set the pace alone', async () => {
    const tracks = readings([
      [0, 10],
      [10, 10],
      [20, 10],
      [30, 16],
    ])
    // The first and last sample alone would read 12%/h.
    const p = pace(tracks.five_hour, 'five_hour', T0 + 30 * MINUTE)
    expect('perHour' in p ? Math.round(p.perHour * 1000) / 1000 : NaN).toBe(10.8)
  })

  test('ignores samples older than the one hour lookback', async () => {
    const tracks = readings([
      [0, 0],
      [60, 20],
      [120, 22],
    ])
    const p = pace(tracks.five_hour, 'five_hour', T0 + 120 * MINUTE)
    expect('perHour' in p && p.span).toBe(HOUR)
    expect('perHour' in p ? Math.round(p.perHour * 1000) / 1000 : NaN).toBe(2)
  })
})

describe('7-day pace', () => {
  const DAY = 24 * HOUR
  const sevenDay = (percentUsed: number, resetsAt: number): SessionRateLimit => ({
    kind: 'seven_day',
    percentUsed,
    resetsAt: new Date(resetsAt).toISOString(),
  })
  /** 0% to 4% over 2.4 busy hours, the samples of the measured session. */
  const busy = (now: number): Tracks => {
    let tracks: Tracks = {}
    const reset = now + 6 * DAY + 18 * HOUR
    for (const [minutes, percent] of [[0, 0], [72, 2], [144, 4]] as const) {
      tracks = record(tracks, [sevenDay(percent, reset)], now - 144 * MINUTE + minutes * MINUTE)
    }
    return tracks
  }

  test('measures through the first day of the cycle, whatever the samples say', async () => {
    const now = T0
    const limit = sevenDay(4, now + 6 * DAY + 18 * HOUR)
    expect(limitPace(limit, busy(now).seven_day, now)).toEqual({ missing: 18 * HOUR })
    expect(statusLine([limit], busy(now), now)).toBe('7d 4%, reset in 6d 18h · measuring the pace')
  })

  test('averages over the whole cycle, so busy hours do not read as a full limit days early', async () => {
    const now = T0
    const limit = sevenDay(30, now + 5 * DAY)
    const p = limitPace(limit, busy(now).seven_day, now)
    expect(p).toEqual({ perHour: 30 / 48, span: 2 * DAY })
    expect(forecast(limit, p, now)).toEqual({ kind: 'full-at', at: now + (70 / (30 / 48)) * HOUR })
    expect(forecast(sevenDay(10, now + 5 * DAY), limitPace(sevenDay(10, now + 5 * DAY), undefined, now), now)).toEqual({
      kind: 'reset-first',
    })
  })

  test('a 7-day limit without a reset time reads its pace from the samples', async () => {
    const limit: SessionRateLimit = { kind: 'seven_day', percentUsed: 4 }
    expect(limitPace(limit, undefined, T0)).toEqual({ missing: DAY })
  })
})

describe('cycles', () => {
  test('a new reset time starts a new cycle and clears the warnings', async () => {
    let tracks = readings([[0, 90]])
    tracks = markWarned(tracks, 'five_hour', [80])
    tracks = record(tracks, [fiveHour(2, '2026-09-18T20:00:00Z')], T0 + MINUTE)
    expect(tracks.five_hour?.samples).toEqual([{ at: T0 + MINUTE, percent: 2 }])
    expect(tracks.five_hour?.warned).toEqual([])
  })

  test('a reset time that moves by seconds keeps the cycle', async () => {
    let tracks = readings([[0, 40]])
    tracks = record(tracks, [fiveHour(41, '2026-09-18T15:00:30Z')], T0 + MINUTE)
    expect(tracks.five_hour?.samples).toHaveLength(2)
  })

  test('without a reset time a falling percentage starts a new cycle', async () => {
    const tracks = readings(
      [
        [0, 60],
        [1, 3],
      ],
      undefined,
    )
    expect(tracks.five_hour?.samples).toEqual([{ at: T0 + MINUTE, percent: 3 }])
  })
})

describe('forecast', () => {
  const now = T0 + 30 * MINUTE

  test('names the time the limit fills when that is before the reset', async () => {
    expect(forecast(fiveHour(50), { perHour: 25, span: HOUR }, now)).toEqual({ kind: 'full-at', at: now + 2 * HOUR })
  })

  test('says the limit resets first when the pace is too slow', async () => {
    expect(forecast(fiveHour(50), { perHour: 5, span: HOUR }, now)).toEqual({ kind: 'reset-first' })
  })

  test('separates a flat pace, a missing pace and a reached limit', async () => {
    expect(forecast(fiveHour(50), { perHour: 0, span: HOUR }, now)).toEqual({ kind: 'flat' })
    expect(forecast(fiveHour(50), { missing: MINUTE }, now)).toEqual({ kind: 'measuring' })
    expect(forecast(fiveHour(100), { missing: MINUTE }, now)).toEqual({ kind: 'reached' })
  })
})

describe('thresholds', () => {
  test('a jump past both thresholds reports both, highest first, and only once', async () => {
    let tracks = readings([[0, 97]])
    const first = newThresholds(tracks.five_hour ?? { samples: [], warned: [] }, 97)
    expect(first).toEqual([95, 80])
    tracks = markWarned(tracks, 'five_hour', first)
    expect(newThresholds(tracks.five_hour ?? { samples: [], warned: [] }, 98)).toEqual([])
  })

  test("another session's warnings join only within one cycle", async () => {
    const mine: Tracks = { five_hour: { resetsAt: '2026-09-18T15:00:00Z', samples: [], warned: [80] } }
    const sameCycle: Tracks = { five_hour: { resetsAt: '2026-09-18T15:02:00Z', samples: [], warned: [80, 95] } }
    const oldCycle: Tracks = { five_hour: { resetsAt: '2026-09-18T10:00:00Z', samples: [], warned: [95] } }
    expect(mergeWarned(mine, sameCycle).five_hour?.warned).toEqual([80, 95])
    expect(mergeWarned(mine, oldCycle).five_hour?.warned).toEqual([80])
    expect(mergeWarned(mine, {})).toEqual(mine)
  })
})

describe('text', () => {
  test('formats durations', async () => {
    expect(durationText(20_000)).toBe('<1m')
    expect(durationText(46 * MINUTE)).toBe('46m')
    expect(durationText(125 * MINUTE)).toBe('2h 5m')
    expect(durationText(180 * MINUTE)).toBe('3h')
    expect(durationText(5 * 24 * HOUR + 11 * HOUR + 59 * MINUTE)).toBe('5d 11h')
  })

  test('the status line names the limit that fills first', async () => {
    const tracks = readings([
      [0, 40],
      [30, 60],
    ])
    const now = T0 + 30 * MINUTE
    expect(statusLine([fiveHour(60)], tracks, now)).toBe('5h 60%, reset in 2h 30m · 5h hits 100% in ~1h')
  })

  test('the status line says so when no limit is reported', async () => {
    expect(statusLine([], {}, T0)).toBe('no usage limits reported yet')
  })

  test('a bar over 100% fills every cell and never overflows', async () => {
    expect(barCells(130, 10)).toEqual({ filled: '██████████', empty: '' })
    expect(barCells(25, 8)).toEqual({ filled: '██', empty: '░░░░░░' })
  })
})
