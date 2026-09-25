import { describe, expect, test, tier } from 'claude-code/testing'

import { dailyText, dayOf, gainFileName, graphText, recordsOf, staleGainFiles, summaryText, type GainRecord } from '../hooks/gain.ts'
import { costText, priceOf } from '../hooks/pricing.ts'

tier('user')

const at = (day: number, hour = 12): number => new Date(2026, 8, day, hour).getTime()
const NOW = at(25, 18)

const rec = (day: number, family: string, raw: number, shown: number, project = 'app'): GainRecord => ({ at: at(day), project, family, raw, shown })

describe('gain records', () => {
  test('a file is named by the local day and the session, and files past 90 days go', () => {
    expect(dayOf(at(5, 23))).toBe('2026-09-05')
    expect(gainFileName(at(25), 'abc')).toBe('2026-09-25-abc.jsonl')
    expect(staleGainFiles(['2026-06-26-a.jsonl', '2026-06-27-b.jsonl', '2026-09-25-c.jsonl', 'notes.txt'], NOW)).toEqual(['2026-06-26-a.jsonl'])
  })

  test('a line that is not a record is counted, not read', () => {
    const r = recordsOf(`${JSON.stringify(rec(25, 'git status', 800, 200))}\n{"at":1}\n\nnope\n`)
    expect(r.records).toHaveLength(1)
    expect(r.bad).toBe(2)
  })

  test('the summary names the first day and the families that saved most', () => {
    const records = [rec(20, 'git status', 800, 200), rec(24, 'cargo test', 40_000, 400), rec(25, 'cargo test', 4_000, 400)]
    expect(summaryText(records)).toBe('since 2026-09-20: 3 results · ~11k tokens saved (98%)\ntop commands:\n  cargo test  2 results · ~11k tokens saved (98%)\n  git status  1 result · ~150 tokens saved (75%)')
    expect(summaryText([])).toBe('no Bash result shrunk in the last 90 days')
  })

  test('daily rows and graph bars cover the last days, a quiet day included', () => {
    const records = [rec(23, 'x', 4_000, 0), rec(25, 'x', 2_000, 0)]
    expect(dailyText(records, NOW, 3)).toBe('2026-09-23  1 result · ~1.0k tokens saved (100%)\n2026-09-24  -\n2026-09-25  1 result · ~500 tokens saved (100%)')
    expect(graphText(records, NOW, 3, 10)).toBe(`09-23 ${'█'.repeat(10)} 1.0k\n09-24\n09-25 ${'█'.repeat(5)}      500`)
  })
})

describe('cost', () => {
  test('a model takes the price of its family, the specific one first', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ read: 0.2, write: 8 })
    expect(priceOf('Opus 5')).toEqual({ read: 0.5, write: 10 })
    expect(priceOf('claude-sonnet-4-6')).toEqual({ read: 0.3, write: 6 })
    expect(priceOf('gpt-9')).toBe(undefined)
  })

  test('the saving is priced at the cache write and at each later cache read', () => {
    expect(costText('claude-opus-5-5', 1_000_000, 12.3)).toBe('this session (claude-opus-5-5): $12.30 so far\n~1.0M tokens kept out of the context: $8.00 saved on the cache write when they would have entered,\nand $0.20 on every later request that reads the context back from the cache')
    expect(costText('gpt-9', 500, undefined)).toBe('this session (gpt-9): no cost ledger in this host\n~500 tokens kept out of the context; no price is known for gpt-9')
    expect(costText('claude-opus-5-5', 0, 1)).toBe('this session (claude-opus-5-5): $1.00 so far\nno Bash result shrunk yet')
  })
})
