import { describe, expect, test, tier } from 'claude-code/testing'

import { formatSent, indexTranscript } from '../hooks/time.ts'

tier('user')

// Local times: the label is drawn in the machine's own time zone.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi)

describe('formatSent', () => {
  test('a message sent today shows the time alone', async () => {
    expect(formatSent(at(2026, 9, 18, 21, 58), at(2026, 9, 18, 23, 0))).toBe('21:58')
    expect(formatSent(at(2026, 9, 18, 0, 5), at(2026, 9, 18, 0, 6))).toBe('00:05')
  })

  test('an older message shows the date too', async () => {
    expect(formatSent(at(2026, 9, 17, 23, 59), at(2026, 9, 18, 0, 1))).toBe('17.09.2026 23:59')
    expect(formatSent(at(2025, 12, 31, 9, 7), at(2026, 1, 1, 9, 7))).toBe('31.12.2025 09:07')
  })

  test('the same day and month of another year is not today', async () => {
    expect(formatSent(at(2025, 9, 18, 10, 0), at(2026, 9, 18, 10, 0))).toBe('18.09.2025 10:00')
  })
})

describe('indexTranscript', () => {
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-18T19:10:55.261Z', message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-09-18T19:10:57.000Z' },
    { type: 'system', uuid: 's1', timestamp: '2026-09-18T19:10:58.000Z' },
    { type: 'user', uuid: 'u2', timestamp: 'not a date' },
    { type: 'user', timestamp: '2026-09-18T19:11:00.000Z' },
    { type: 'user', uuid: 'u3', timestamp: '2026-09-18T19:12:00.000Z' },
  ].map(row => JSON.stringify(row))

  test('maps the uuid of every user and assistant row to its time and skips the rest', async () => {
    const index = indexTranscript(lines.join('\n') + '\n')
    expect([...index.times]).toEqual([
      ['u1', Date.parse('2026-09-18T19:10:55.261Z')],
      ['a1', Date.parse('2026-09-18T19:10:57.000Z')],
      ['u3', Date.parse('2026-09-18T19:12:00.000Z')],
    ])
    expect(index.broken).toBe(0)
  })

  test('counts a line that is not JSON instead of failing', async () => {
    const index = indexTranscript(`${lines[0]}\n{"type":"user","uu`)
    expect(index.times.size).toBe(1)
    expect(index.broken).toBe(1)
  })
})
