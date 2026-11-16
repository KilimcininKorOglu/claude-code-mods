import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Memory } from '../../hooks/shared/model.ts'
import { RELATION_FLOOR, memoryQueryRelevance, memoryStructuralRelevance, pathAnchorRelation, reminderScore, turnScore } from '../relevance.ts'

function memoryOf(fields: Partial<Memory>): Memory {
  return {
    id: 'M1',
    revision: 1,
    scope: 'project',
    kind: 'fact',
    status: 'active',
    contextPolicy: 'auto',
    persistence: 'long_lived',
    text: 'The connection pool keeps twenty sockets for each worker',
    importance: 0.6,
    confidence: 0.8,
    freshness: 1,
    tags: [],
    anchors: [],
    sources: [{ type: 'user' }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...fields,
  }
}

describe('what a query says about a memory', () => {
  test('an anchor value spelled out in the query is the strongest evidence', () => {
    const memory = memoryOf({ anchors: [{ type: 'symbol', path: 'src/db.ts', symbol: 'createPool' }] })
    assert.deepEqual(memoryQueryRelevance(memory, 'why does createPool retry'), { strength: 0.98, reasons: ['query:exact-symbol'] })
    const file = memoryOf({ anchors: [{ type: 'file', path: 'src/db.ts' }] })
    assert.equal(memoryQueryRelevance(file, 'read src/db.ts').strength, 0.96)
  })

  test('shared words, tags and anchor words alone are no evidence of a memory: the store weighs them', () => {
    assert.equal(memoryQueryRelevance(memoryOf({ text: 'Fix the test file before you run the code' }), 'fix test file code').strength, 0)
    assert.equal(memoryQueryRelevance(memoryOf({ anchors: [{ type: 'command', command: 'pnpm migrate:deploy' }] }), 'pnpm migrate').strength, 0)
    assert.equal(memoryQueryRelevance(memoryOf({ tags: ['postgres', 'pooling'] }), 'postgres pooling').strength, 0)
    assert.equal(memoryQueryRelevance(memoryOf({}), 'connection pool sockets worker').strength, 0)
  })

  test('a graph neighbour needs a shared anchor or two shared tags', () => {
    const seed = memoryOf({ id: 'S', anchors: [{ type: 'symbol', path: 'src/a.ts', symbol: 'createPool' }], tags: ['postgres', 'pooling'] })
    const sameSymbol = memoryOf({ anchors: [{ type: 'symbol', path: 'src/b.ts', symbol: 'createPool' }] })
    assert.equal(memoryStructuralRelevance(sameSymbol, [seed]).strength, 0.86)
    assert.equal(memoryStructuralRelevance(memoryOf({ tags: ['postgres', 'pooling', 'infra'] }), [seed]).strength, 0.72)
    assert.equal(memoryStructuralRelevance(memoryOf({ tags: ['postgres'] }), [seed]).strength, 0)
  })
})

describe('how an anchor relates to a touched path', () => {
  test('an anchor on the path itself is exact, a symbol in it the strongest, whatever the anchor order', () => {
    const memory = memoryOf({ anchors: [{ type: 'file', path: 'src/db.ts' }, { type: 'symbol', path: 'src/db.ts', symbol: 'poolSize' }] })
    assert.deepEqual(pathAnchorRelation(memory, 'src/db.ts'), { strength: 0.98, reasons: ['anchor:exact-symbol:src/db.ts'] })
  })

  test('a test, git, directory or package anchor on the path itself is exact too', () => {
    for (const type of ['test', 'git', 'directory', 'package'] as const) {
      assert.equal(pathAnchorRelation(memoryOf({ anchors: [{ type, path: 'src/db' }] }), 'src/db')?.strength, 0.95, type)
    }
  })

  test('a directory relates above the reminder floor to the paths as far below it as it lies under the root, the closer first', () => {
    const memory = memoryOf({ anchors: [{ type: 'directory', path: 'packages/api' }] })
    const near = pathAnchorRelation(memory, 'packages/api/db.ts')?.strength ?? 0
    const second = pathAnchorRelation(memory, 'packages/api/src/db.ts')?.strength ?? 0
    assert.ok(near >= RELATION_FLOOR && second >= RELATION_FLOOR, 'two levels down from a directory two levels deep')
    assert.ok(near > second, 'the closer file relates more strongly')
    assert.ok((pathAnchorRelation(memoryOf({ anchors: [{ type: 'directory', path: 'src' }] }), 'src/db.ts')?.strength ?? 0) >= RELATION_FLOOR, 'a top-level directory and a file right under it')
    assert.equal(pathAnchorRelation(memory, 'packages/apiserver/db.ts'), undefined)
    assert.equal(pathAnchorRelation(memory, '.'), undefined)
  })

  test('past that reach a directory relates below the reminder floor, so a directory near the root does not remind of the whole project', () => {
    const below = (dir: string, path: string) => (pathAnchorRelation(memoryOf({ anchors: [{ type: 'directory', path: dir }] }), path)?.strength ?? 1) < RELATION_FLOOR
    assert.ok(below('src', 'src/lib/db.ts'), 'a top-level directory and a file two levels down')
    assert.ok(below('plugins', 'plugins/context-restore/README.md'), 'the measured case: a note on every mod and one mod\'s README')
    assert.ok(below('packages/api', 'packages/api/src/lib/db.ts'))
    assert.ok(!below('plugins/sage-memory', 'plugins/sage-memory/daemon/remind.ts'), 'one mod\'s note still reaches its own files')
  })

  test('a query that spells a top-level directory\'s one word is no exact match of its anchor; a deeper directory\'s path is', () => {
    const top = memoryOf({ text: 'Every mod keeps its own Makefile', anchors: [{ type: 'directory', path: 'plugins' }] })
    assert.ok(memoryQueryRelevance(top, 'plugins context restore README md').strength < RELATION_FLOOR)
    const mod = memoryOf({ text: 'The daemon runs on Node 22', anchors: [{ type: 'directory', path: 'plugins/sage-memory' }] })
    assert.deepEqual(memoryQueryRelevance(mod, 'why does plugins/sage-memory need node').reasons, ['query:exact-directory'])
  })
})

describe('reminder scores', () => {
  test('relation and metadata weigh alike, and persistence, use and anchoring move the score', () => {
    const anchored = memoryOf({ anchors: [{ type: 'file', path: 'src/db.ts' }] })
    const base = reminderScore(anchored, 0.95)
    assert.ok(base > 0.8 && base <= 1)
    assert.ok(reminderScore(memoryOf({}), 0.95) < base, 'an unanchored memory scores lower')
    assert.ok(reminderScore({ ...anchored, persistence: 'short_lived' }, 0.95) < base)
    assert.equal(reminderScore({ ...anchored, reminderCount: 5 }, 0.95), base, 'reminders without a counted use are no evidence against a memory')
    assert.ok(reminderScore({ ...anchored, useCount: 2 }, 0.9) > reminderScore(anchored, 0.9), 'a used memory scores higher')
  })

  test('a prompt reminder scales the metadata by relevance', () => {
    const important = memoryOf({ importance: 0.9, confidence: 0.9, anchors: [{ type: 'file', path: 'src/db.ts' }] })
    assert.ok(turnScore(important, 0.86) >= 0.65)
    assert.ok(turnScore(memoryOf({}), 0.72) < 0.65, 'a default memory with weak relevance stays out')
  })
})
