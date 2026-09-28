import { describe, expect, test, tier } from 'claude-code/testing'
import { stepsOf, tallyLine } from '../hooks/curate.ts'
import type { Memory } from '../hooks/shared/model.ts'

tier('user')

function memory(id: string, permanent = false): Memory {
  return {
    id, revision: 1, scope: 'project', kind: 'fact', status: 'active', contextPolicy: 'auto', persistence: permanent ? 'permanent' : 'long_lived', text: id,
    importance: 0.6, confidence: 0.8, freshness: 1, tags: [], anchors: [], sources: [], createdAt: '', updatedAt: '',
  }
}

const SHOWN = [memory('a'), memory('b'), memory('p', true)]
const steps = (operations: unknown[]) => stepsOf(JSON.stringify({ operations }), SHOWN, 's1')

describe('curate', () => {
  test('an id the curator was not shown, and a permanent memory, are never retired', () => {
    expect(steps([{ action: 'supersede', targetId: 'x' }, { action: 'supersede', targetId: 'p' }, { action: 'supersede', targetId: 'a' }])).toEqual([
      { kind: 'update', id: 'a', patch: { status: 'superseded' }, count: 'superseded' },
    ])
  })

  test('a contradiction needs a shown memory on the other side', () => {
    expect(steps([{ action: 'contradict', targetId: 'a', contradictsWith: 'a fact' }, { action: 'contradict', targetId: 'a', contradictsWith: 'b' }])).toEqual([
      { kind: 'update', id: 'a', patch: { status: 'contradicted', contradicts: ['b'] }, count: 'contradicted' },
    ])
  })

  test('a merge replaces only the retirable shown ids, and a split its target with at most four items', () => {
    const [merge, split] = steps([
      { action: 'merge', targetIds: ['a', 'p', 'zz', 'a'], text: 'One fact.' },
      { action: 'split', targetId: 'b', items: [1, 2, 3, 4, 5].map(n => ({ text: `Rule ${n}.` })) },
    ])
    expect(merge).toMatchObject({ kind: 'replace', replaced: ['a'], count: 'merged' })
    expect(split).toMatchObject({ kind: 'replace', replaced: ['b'], count: 'split' })
    expect(split?.kind === 'replace' ? split.inputs.map(i => i.text) : []).toEqual(['Rule 1.', 'Rule 2.', 'Rule 3.', 'Rule 4.'])
  })

  test('a recalibration holds scores to 0..1, marks a stale status as a review, and keeps a permanent memory from being archived', () => {
    expect(steps([{ action: 'recalibrate', targetId: 'a', importance: -2, status: 'stale' }, { action: 'recalibrate', targetId: 'p', status: 'archived' }, { action: 'keep', targetId: 'b' }])).toEqual([
      { kind: 'update', id: 'a', patch: { status: 'stale', staleReason: 'review', importance: 0 }, count: 'recalibrated' },
    ])
  })

  test('the line names only the counts that moved', () => {
    expect(tallyLine({ superseded: 0, contradicted: 1, merged: 0, split: 2, recalibrated: 0 })).toBe('curated: 1 contradicted, 2 split')
    expect(tallyLine({ superseded: 0, contradicted: 0, merged: 0, split: 0, recalibrated: 0 })).toBe(undefined)
  })
})
