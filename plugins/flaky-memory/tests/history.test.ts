import { describe, expect, test, tier } from 'claude-code/testing'

import { emptyHistory, listText, notesFor, readHistory, record, verdictOf, WINDOW_MS, type History } from '../hooks/history.ts'

tier('user')

const T0 = Date.parse('2026-09-19T10:00:00Z')
const run = (h: History, at: number, fp: string, failed: string[], passed: string[] = [], exitedOk = failed.length === 0, command = 'go test ./...') =>
  record(h, { now: at, fp, command, outcome: { failed, passed }, exitedOk })

describe('history', () => {
  test('a test that fails and then passes on the same code is flaky; on new code it is not', async () => {
    let h = run(emptyHistory(), T0, 'A', ['go:TestX'])
    expect(notesFor(h, ['go:TestX'], T0)).toEqual([])
    h = run(h, T0 + 1, 'A', [], ['go:TestX'])
    h = run(h, T0 + 2, 'B', ['go:TestX'])
    expect(verdictOf(h.tests['go:TestX'] ?? [], T0 + 2)).toEqual({ runs: 3, failures: 2, sameCode: 1 })
    expect(notesFor(h, ['go:TestX'], T0 + 2)).toEqual([
      'flaky-memory: go:TestX failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once. It may be flaky rather than broken by this change: run it again before you change code for it.',
    ])
    const fixed = run(run(emptyHistory(), T0, 'A', ['go:TestY']), T0 + 1, 'B', [], ['go:TestY'])
    expect(verdictOf(fixed.tests['go:TestY'] ?? [], T0 + 1).sameCode).toBe(0)
  })

  test('the same command exiting 0 counts the tests it failed before as passed, when the output names none', async () => {
    let h = run(emptyHistory(), T0, 'A', ['js:adds'], [], false, 'npm test')
    h = run(h, T0 + 1, 'A', [], [], true, 'npm test')
    expect(h.tests['js:adds']?.map(r => r.ok)).toEqual([false, true])
    expect(h.failedBy).toEqual({})
    h = run(h, T0 + 2, 'A', [], [], true, 'npm test')
    expect(h.tests['js:adds']).toHaveLength(2)
  })

  test('stores no pass of a test that never failed, and drops runs older than 7 days', async () => {
    let h = run(emptyHistory(), T0, 'A', [], ['go:TestA', 'go:TestB'])
    expect(h.tests).toEqual({})
    h = run(h, T0, 'A', ['go:TestA'])
    h = run(h, T0 + WINDOW_MS + 1, 'B', [], ['go:TestB'])
    expect(h.tests).toEqual({})
  })

  test('reads only the stored shape, and lists the flaky tests', async () => {
    expect(readHistory(undefined)).toEqual(emptyHistory())
    expect(readHistory({ tests: { a: [{ at: 1 }] }, failedBy: {} })).toBe(undefined)
    expect(readHistory('x')).toBe(undefined)
    const h = run(run(emptyHistory(), T0, 'A', ['go:TestX']), T0 + 1, 'A', [], ['go:TestX'])
    expect(listText(h, T0 + 1)).toBe('go:TestX · failed 1/2 · same code once')
    expect(listText(emptyHistory(), T0)).toBe('no flaky test in the last 7 days (0 tests seen)')
  })
})
