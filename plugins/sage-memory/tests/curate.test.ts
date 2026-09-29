import { describe, expect, test, tier } from 'claude-code/testing'
import { additionsOf } from '../hooks/consolidate.ts'
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
const steps = (operations: unknown[]) => stepsOf(JSON.stringify({ operations }), SHOWN, { sessionId: 's1', root: '/repo' })

describe('curate', () => {
  test('a memory the session made wrong is deleted, never one the curator was not shown or a permanent one', () => {
    expect(steps([{ action: 'delete', targetId: 'x' }, { action: 'delete', targetId: 'p' }, { action: 'delete', targetId: 'a', reason: 'the timer moved' }])).toEqual([
      { kind: 'delete', id: 'a', reason: 'curator: the timer moved', count: 'deleted' },
    ])
    // SAGE's supersede still reaches the curator's answers; it deletes too, and an archive does.
    expect(steps([{ action: 'supersede', targetId: 'b' }, { action: 'recalibrate', targetId: 'a', status: 'archived' }]).map(s => (s.kind === 'delete' ? s.id : s.kind))).toEqual(['b', 'a'])
  })

  test('a memory whose value changed is rewritten, and a permanent one is not', () => {
    expect(steps([{ action: 'update', targetId: 'a', text: ' The limit is 20. ' }, { action: 'update', targetId: 'p', text: 'x' }, { action: 'update', targetId: 'b', text: '' }])).toEqual([
      { kind: 'update', id: 'a', patch: { text: 'The limit is 20.' }, count: 'rewritten' },
    ])
  })

  test('a contradiction deletes the wrong side, and needs a shown memory on the other side', () => {
    expect(steps([{ action: 'contradict', targetId: 'a', contradictsWith: 'a fact' }, { action: 'contradict', targetId: 'a', contradictsWith: 'b' }])).toEqual([
      { kind: 'delete', id: 'a', reason: 'curator: contradicted by b', count: 'deleted' },
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

  test('an anchor the daemon would refuse is dropped and the memory is still written', () => {
    const anchors = [
      { type: 'file', path: '/repo/src/a.ts' },
      { type: 'file', path: '/tmp/elsewhere/b.ts' },
      { type: 'file', path: '../sibling/c.ts' },
      { type: 'command' },
      { type: 'command', command: 'make test' },
      { type: 'symbol', path: 'src/a.ts' },
      { type: 'symbol', path: 'src/a.ts', symbol: 'run' },
    ]
    const [merge] = steps([{ action: 'merge', targetIds: ['a'], text: 'One fact.', anchors }])
    expect(merge?.kind === 'replace' ? merge.inputs[0]?.anchors : undefined).toEqual([
      { type: 'file', path: 'src/a.ts' },
      { type: 'command', command: 'make test' },
      { type: 'symbol', path: 'src/a.ts', symbol: 'run' },
    ])
  })

  test('a file or symbol note left with no anchor is written as a fact, because the daemon refuses such a note', () => {
    const [merge, split] = steps([
      { action: 'merge', targetIds: ['a'], text: 'One fact.', type: 'file_note', anchors: [{ type: 'file', path: '/elsewhere/x.ts' }] },
      { action: 'split', targetId: 'b', items: [{ text: 'Rule.', type: 'symbol_note' }, { text: 'Kept.', type: 'file_note', anchors: [{ type: 'file', path: 'src/a.ts' }] }] },
    ])
    expect(merge?.kind === 'replace' ? merge.inputs.map(i => i.kind) : []).toEqual(['fact'])
    expect(split?.kind === 'replace' ? split.inputs.map(i => i.kind) : []).toEqual(['fact', 'file_note'])
    expect(additionsOf(JSON.stringify({ candidates: [{ is: 'keep', memory: { text: 'A note.', kind: 'reference', anchors: [] } }] }), 's1', '/repo').map(i => i.kind)).toEqual(['fact'])
  })

  test('the line names only the counts that moved, a deletion red and any other change yellow', () => {
    expect(tallyLine({ rewritten: 0, deleted: 1, merged: 0, split: 2, recalibrated: 0 })).toEqual({
      text: 'curated: 1 deleted, 2 split',
      kind: 'error',
      parts: [{ text: 'curated: ', kind: 'dim' }, { text: '1 deleted', kind: 'error' }, { text: ', ', kind: 'dim' }, { text: '2 split', kind: 'warn' }],
    })
    expect(tallyLine({ rewritten: 3, deleted: 0, merged: 0, split: 0, recalibrated: 0 })?.kind).toBe('warn')
    expect(tallyLine({ rewritten: 0, deleted: 0, merged: 0, split: 0, recalibrated: 0 })).toBe(undefined)
  })
})
