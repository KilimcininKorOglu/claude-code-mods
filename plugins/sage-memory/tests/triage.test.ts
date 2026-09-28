import { describe, expect, test, tier } from 'claude-code/testing'
import { actionOf, mergeOf, mergesOf, mergeVerdictOf, pairsOf, patchOf, preFilter, proposalsToFile, ratingOf, valueScore } from '../hooks/triage.ts'
import type { Candidate, Memory } from '../hooks/shared/model.ts'

tier('user')

const NOW = Date.parse('2026-09-28T12:00:00Z')

function memory(id: string, extra: Partial<Memory> = {}): Memory {
  return {
    id, revision: 1, scope: 'project', kind: 'fact', status: 'active', contextPolicy: 'auto', persistence: 'long_lived', text: `Memory ${id} states one durable project fact.`,
    importance: 0.6, confidence: 0.8, freshness: 1, tags: [], anchors: [], sources: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...extra,
  }
}

describe('triage', () => {
  test('phase 1 keeps the strong cases first and discards only clear debris', () => {
    expect(preFilter(memory('a', { importance: 0.95, text: 'wip: x' }), NOW).verdict).toBe('keep')
    // An answer that names a memory to say it is wrong counts as a use, so a use keeps nothing by itself.
    expect(preFilter(memory('u', { useCount: 1, text: 'The daemon needs an explicit reload to reconnect.' }), NOW).verdict).toBe('uncertain')
    expect(preFilter(memory('b', { text: 'Test suite must run from the repository root.' }), NOW).verdict).toBe('uncertain')
    expect(preFilter(memory('c', { text: 'WIP: try the other parser today' }), NOW)).toEqual({ verdict: 'discard', reasons: ['text starts with a transient marker'] })
    expect(preFilter(memory('d', { expiresAt: '2026-09-01T00:00:00Z' }), NOW).reasons).toEqual(['expired at 2026-09-01T00:00:00Z'])
  })

  test('phase 2 adds the five sub-scores into its bands', () => {
    const anchored = memory('a', { anchors: [{ type: 'file', path: 'a.ts' }, { type: 'symbol', symbol: 'f', path: 'a.ts' }], tags: ['x', 'y', 'z'], useCount: 2, lastVerifiedAt: '2026-09-20T00:00:00Z' })
    expect(valueScore(anchored, NOW)).toEqual({ total: 21 + 22 + 20 + 12 + 10, band: 'keep' })
    expect(valueScore(memory('b', { reminderCount: 6, persistence: 'short_lived', kind: 'summary', text: 'short' }), NOW)).toEqual({ total: 0 + 3 + 5 + 2 + 3, band: 'discard' })
  })

  test('a reply without a 1-5 score is no rating; a low rating deletes, and importance 0.9 is left to a person', () => {
    expect(ratingOf('I think it is fine')).toBe(undefined)
    expect(ratingOf('4 | useful')).toEqual({ score: 4, reason: 'useful' })
    const gray = { total: 45, band: 'gray' as const }
    expect(actionOf(memory('a'), gray, { score: 3, reason: '' })).toBe('stale')
    expect(actionOf(memory('a'), gray, { score: 2, reason: '' })).toBe('delete')
    expect(patchOf(memory('a'), 'delete', { score: 2, reason: '' })).toEqual({})
    expect(actionOf(memory('a', { importance: 0.95 }), gray, { score: 1, reason: '' })).toBe('investigate')
    expect(patchOf(memory('a'), 'stale', { score: 3, reason: '' })).toEqual({ status: 'stale', staleReason: 'review', confidence: 0.4 })
  })

  test('pairs come from shared anchors or three shared tags, each once', () => {
    const a = memory('a', { anchors: [{ type: 'file', path: 'x.ts' }], tags: ['p', 'q', 'r'] })
    const b = memory('b', { anchors: [{ type: 'file', path: 'x.ts' }], tags: ['p', 'q', 'r'] })
    const c = memory('c', { tags: ['p', 'q'] })
    expect(pairsOf([a, b, c], 50).map(pair => `${pair.a.id}${pair.b.id}`)).toEqual(['ab'])
  })

  test('an empty reply is no verdict, and a protected or older memory keeps its place', () => {
    expect(mergeVerdictOf('  ')).toBe(undefined)
    expect(mergeVerdictOf('overlap, related')).toBe('OVERLAP')
    const older = memory('old', { createdAt: '2026-01-01T00:00:00Z' })
    const newer = memory('new', { createdAt: '2026-06-01T00:00:00Z', text: older.text })
    expect(mergeOf({ a: newer, b: older })).toMatchObject({ keeper: { id: 'old' }, loser: { id: 'new' } })
    const pinned = memory('pin', { persistence: 'permanent', text: 'x' })
    expect(mergeOf({ a: memory('long', { text: older.text.repeat(3) }), b: pinned })).toMatchObject({ keeper: { id: 'pin' } })
    expect(mergeOf({ a: pinned, b: memory('vip', { importance: 0.9 }) })).toBe(undefined)
  })

  test('a memory loses at most once, so no merge cycle forms', () => {
    const [a, b, c] = [memory('a', { createdAt: '2026-01-01T00:00:00Z' }), memory('b', { createdAt: '2026-02-01T00:00:00Z' }), memory('c', { createdAt: '2026-03-01T00:00:00Z' })]
    expect(mergesOf([{ a, b }, { a: b, b: c }, { a: c, b: a }]).map(m => `${m.loser.id}>${m.keeper.id}`)).toEqual(['b>a', 'c>a'])
  })

  test('a proposal is not filed twice, nor for an unchanged memory a person reviewed within 90 days', () => {
    const a = memory('a')
    const b = memory('b')
    const candidates = [
      { id: 'c1', status: 'pending', targetMemoryId: 'a', kind: 'memory_review', text: 'x', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'c2', status: 'rejected', targetMemoryId: 'b', kind: 'memory_review', text: b.text.slice(0, 80), updatedAt: '2026-09-01T00:00:00Z' },
    ] as unknown as Candidate[]
    const proposals = [a, b, memory('c'), memory('c')].map(m => ({ memory: m, suggestedAction: 'archive' as const, reason: 'r' }))
    expect(proposalsToFile(proposals, candidates, NOW).map(p => p.memory.id)).toEqual(['c'])
  })
})
