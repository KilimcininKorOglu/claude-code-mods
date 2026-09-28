import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Memory } from '../../hooks/shared/model.ts'
import { memoryQueryRelevance, memoryStructuralRelevance, pathAnchorRelation, reminderScore, turnScore } from '../relevance.ts'

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

  test('generic coding words are no evidence, and one word out of a long query is none either', () => {
    const memory = memoryOf({ text: 'Fix the test file before you run the code' })
    assert.equal(memoryQueryRelevance(memory, 'fix test file code').strength, 0)
    assert.equal(memoryQueryRelevance(memoryOf({}), 'sockets deploy staging branch release notes').strength, 0)
  })

  test('shared anchor terms, tags and text reach their tiers', () => {
    const anchored = memoryOf({ anchors: [{ type: 'command', command: 'pnpm migrate:deploy' }] })
    assert.equal(memoryQueryRelevance(anchored, 'pnpm migrate').strength, 0.88, 'two anchor terms')
    const tagged = memoryOf({ tags: ['postgres', 'pooling'] })
    assert.equal(memoryQueryRelevance(tagged, 'postgres pooling').strength, 0.84, 'two tags')
    assert.equal(memoryQueryRelevance(memoryOf({}), 'connection pool sockets worker').strength, 0.84, 'four text terms answer the query')
    assert.equal(memoryQueryRelevance(memoryOf({}), 'sockets').strength, 0.66, 'one word of a one-word query')
  })

  test('a question in plain or suffixed words finds a memory that names an identifier', () => {
    const memory = memoryOf({ text: 'RETRY_LIMIT value must not be changed without consulting the ops team first.' })
    assert.equal(memoryQueryRelevance(memory, 'retry limit kaç').strength, 0.72, 'the identifier holds its words')
    assert.equal(memoryQueryRelevance(memory, 'Retry limiti kaç ve değiştirmek için kime sormalıyım?').strength, 0.68, 'a Turkish suffix keeps its stem')
    assert.equal(memoryQueryRelevance(memoryOf({ text: 'Call retryLimit before each send' }), 'retry limit').strength, 0.72, 'camelCase splits too')
    assert.equal(memoryQueryRelevance(memory, 'retrying limitations elsewhere').strength, 0, 'a suffix longer than four letters is another word')
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

  test('a directory above the path relates to every path below it, weaker with each level but above the reminder floor', () => {
    const memory = memoryOf({ anchors: [{ type: 'directory', path: 'packages/api' }] })
    assert.equal(pathAnchorRelation(memory, 'packages/api/db.ts')?.strength.toFixed(2), '0.94')
    assert.equal(pathAnchorRelation(memory, 'packages/api/src/lib/db.ts')?.strength.toFixed(2), '0.90')
    assert.equal(pathAnchorRelation(memory, 'packages/api/a/b/c/d/e/f/db.ts')?.strength.toFixed(2), '0.86')
    assert.equal(pathAnchorRelation(memoryOf({ anchors: [{ type: 'directory', path: 'src' }] }), 'src/db.ts')?.strength.toFixed(2), '0.94')
    assert.equal(pathAnchorRelation(memory, 'packages/apiserver/db.ts'), undefined)
    assert.equal(pathAnchorRelation(memory, '.'), undefined)
  })
})

describe('reminder scores', () => {
  test('relation and metadata weigh alike, and persistence, use and anchoring move the score', () => {
    const anchored = memoryOf({ anchors: [{ type: 'file', path: 'src/db.ts' }] })
    const base = reminderScore(anchored, 0.95)
    assert.ok(base > 0.8 && base <= 1)
    assert.ok(reminderScore(memoryOf({}), 0.95) < base, 'an unanchored memory scores lower')
    assert.ok(reminderScore({ ...anchored, persistence: 'short_lived' }, 0.95) < base)
    assert.ok(reminderScore({ ...anchored, reminderCount: 5 }, 0.95) < base, 'reminded five times, never used')
    assert.ok(reminderScore({ ...anchored, useCount: 2 }, 0.9) > reminderScore(anchored, 0.9), 'a used memory scores higher')
  })

  test('a prompt reminder scales the metadata by relevance', () => {
    const important = memoryOf({ importance: 0.9, confidence: 0.9, anchors: [{ type: 'file', path: 'src/db.ts' }] })
    assert.ok(turnScore(important, 0.86) >= 0.65)
    assert.ok(turnScore(memoryOf({}), 0.72) < 0.65, 'a default memory with weak relevance stays out')
  })
})
