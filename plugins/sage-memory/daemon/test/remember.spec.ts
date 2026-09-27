import assert from 'node:assert/strict'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { recordReminder, recordUse } from '../counters.ts'
import { updateMemory } from '../update.ts'
import { cleanUp, tempDir } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

const MIGRATIONS = 'Run the database migrations with pnpm before starting the dev server'

describe('remember', () => {
  test('a new memory gets the defaults, and defaulted scores are capped by its quality', async () => {
    const w = world()
    const { memory, outcome } = await w.remember({ text: `  ${MIGRATIONS}  ` })
    assert.equal(outcome, 'added')
    assert.equal(memory.text, MIGRATIONS)
    assert.deepEqual([memory.scope, memory.kind, memory.status, memory.persistence, memory.contextPolicy], ['project', 'fact', 'active', 'long_lived', 'auto'])
    assert.deepEqual([memory.importance, memory.confidence, memory.freshness], [0.6, 0.75, 1], 'an unanchored memory keeps at most 0.75 confidence')
    assert.deepEqual(memory.sources, [{ type: 'user' }])
    assert.equal(memory.revision, 1)
    assert.deepEqual(w.read(memory.id), JSON.parse(JSON.stringify(memory)), 'the stored record is the one answered')
    w.close()
  })

  test('a score the caller gives is not capped', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS, importance: 0.95, confidence: 0.9 })
    assert.deepEqual([memory.importance, memory.confidence], [0.95, 0.9])
    w.close()
  })

  test('the same text in another case, spacing or end punctuation merges into the memory', async () => {
    const w = world()
    const first = await w.remember({ text: MIGRATIONS, tags: ['db'], importance: 0.5 })
    const second = await w.remember({ text: `${MIGRATIONS.toUpperCase()}.`, tags: ['#Dev'], importance: 0.8, confidence: 0.6 })
    assert.equal(second.outcome, 'merged')
    assert.equal(second.nearDuplicate, false)
    assert.equal(second.memory.id, first.memory.id)
    assert.equal(second.memory.text, MIGRATIONS, 'an exact match keeps the stored wording')
    assert.deepEqual(second.memory.tags, ['db', 'dev'])
    assert.deepEqual([second.memory.importance, second.memory.confidence], [0.8, 0.75], 'each score keeps the larger value')
    assert.equal(second.memory.revision, 2)
    w.close()
  })

  test('a paraphrase of the same kind merges and keeps the richer wording', async () => {
    const w = world()
    const first = await w.remember({ text: 'Run database migrations with pnpm before starting the dev server' })
    const richer = 'Before starting the dev server, run database migrations with pnpm from the repository root'
    const second = await w.remember({ text: richer })
    assert.equal(second.outcome, 'merged')
    assert.equal(second.nearDuplicate, true)
    assert.equal(second.memory.id, first.memory.id)
    assert.equal(second.memory.text, richer)
    w.close()
  })

  test('a claim and its negation stay two memories', async () => {
    const w = world()
    const a = await w.remember({ text: 'The payment webhook handler is stable under concurrent retries' })
    const b = await w.remember({ text: 'The payment webhook handler is not stable under concurrent retries' })
    assert.equal(b.outcome, 'added')
    assert.notEqual(a.memory.id, b.memory.id)
    w.close()
  })

  test('a claim with another number stays a second memory, and the first keeps its own', async () => {
    const w = world()
    const a = await w.remember({ text: 'Retry the upload 3 times before failing the job' })
    const b = await w.remember({ text: 'Retry the upload 5 times before failing the job' })
    assert.equal(b.outcome, 'added')
    assert.deepEqual([w.read(a.memory.id).text, b.memory.text], ['Retry the upload 3 times before failing the job', 'Retry the upload 5 times before failing the job'])
    w.close()
  })

  test('writing a stale memory again makes it active', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS })
    await w.run(op => updateMemory(op, { id: memory.id, patch: { status: 'stale' } }))
    const again = await w.remember({ text: MIGRATIONS })
    assert.equal(again.reactivated, true)
    assert.equal(again.memory.status, 'active')
    assert.equal(again.memory.staleReason, undefined)
    w.close()
  })

  test('session memories merge only within their own session', async () => {
    const w = world()
    const a = await w.remember({ text: MIGRATIONS, scope: 'session', ownerSessionId: 's1' })
    const b = await w.remember({ text: MIGRATIONS, scope: 'session', ownerSessionId: 's2' })
    const c = await w.remember({ text: MIGRATIONS, scope: 'session', ownerSessionId: 's1' })
    assert.notEqual(a.memory.id, b.memory.id)
    assert.equal(c.memory.id, a.memory.id)
    assert.equal(b.memory.ownerSessionId, 's2')
    w.close()
  })

  test('another audience is another memory', async () => {
    const w = world()
    const plain = await w.remember({ text: MIGRATIONS })
    const scoped = await w.remember({ text: MIGRATIONS, audience: { roles: ['Explore'] } })
    assert.notEqual(plain.memory.id, scoped.memory.id)
    assert.deepEqual(scoped.memory.audience, { roles: ['explore'] })
    w.close()
  })

  test('a merge never lowers permanence, and changes the context policy only when told', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS, persistence: 'permanent', contextPolicy: 'always' })
    const again = await w.remember({ text: MIGRATIONS, persistence: 'short_lived' })
    assert.equal(again.memory.id, memory.id)
    assert.equal(again.memory.persistence, 'permanent')
    assert.equal(again.memory.contextPolicy, 'always')
    const never = await w.remember({ text: MIGRATIONS, contextPolicy: 'never' })
    assert.equal(never.memory.contextPolicy, 'never')
    w.close()
  })

  test('the memories a new one supersedes become superseded by it', async () => {
    const w = world()
    const old = await w.remember({ text: 'Deploys go through the staging branch before production' })
    const next = await w.remember({ text: 'Deploys go straight to production behind a feature flag', supersedes: [old.memory.id] })
    assert.deepEqual(next.superseded, [old.memory.id])
    const stored = w.read(old.memory.id)
    assert.equal(stored.status, 'superseded')
    assert.equal(stored.supersededBy, next.memory.id)
    assert.ok(w.edges().includes(`mem:${next.memory.id} supersedes mem:${old.memory.id}`))
    w.close()
  })

  test('a relationship must name a live memory of the same store', async () => {
    const w = world()
    await assert.rejects(w.remember({ text: MIGRATIONS, supersedes: ['NOPE'] }), /supersedes names NOPE, which is not a live memory in the project store/)
    const user = await w.remember({ text: 'Prefer pnpm over npm in every project', scope: 'user' }, w.global)
    await assert.rejects(w.remember({ text: MIGRATIONS, contradicts: [user.memory.id] }), /is not a live memory in the project store/)
    w.close()
  })
})

describe('anchors', () => {
  test('a path anchor is stored relative to the project root, and one outside it is refused', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS, anchors: [{ type: 'file', path: join(w.root, 'src', 'app.ts') }, { type: 'agent', role: ' Explore ' }] })
    assert.deepEqual(memory.anchors, [
      { type: 'file', path: 'src/app.ts' },
      { type: 'agent', role: 'explore' },
    ])
    await assert.rejects(w.remember({ text: MIGRATIONS, anchors: [{ type: 'file', path: '../outside.ts' }] }), /is outside the project root/)
    w.close()
  })

  test('a symlink that leads out of the project is refused', async () => {
    const w = world()
    const outside = tempDir()
    symlinkSync(outside, join(w.root, 'escape'))
    await assert.rejects(w.remember({ text: MIGRATIONS, anchors: [{ type: 'directory', path: 'escape' }] }), /is outside the project root/)
    w.close()
  })

  test('a file link keeps its own name, and a link from outside is stored as the project path it leads to', async () => {
    const w = world()
    const outside = tempDir()
    symlinkSync('src/app.ts', join(w.root, 'link.ts'))
    symlinkSync(join(w.root, 'src', 'app.ts'), join(outside, 'app-link.ts'))
    const { memory } = await w.remember({ text: MIGRATIONS, anchors: [{ type: 'file', path: 'link.ts' }, { type: 'file', path: join(outside, 'app-link.ts') }] })
    assert.deepEqual(memory.anchors, [
      { type: 'file', path: 'link.ts' },
      { type: 'file', path: 'src/app.ts' },
    ])
    w.close()
  })

  test('a user memory takes command and agent anchors, and no path', async () => {
    const w = world()
    const { memory } = await w.remember({ text: 'Prefer pnpm over npm in every project', scope: 'user', anchors: [{ type: 'command', command: 'pnpm  install' }] }, w.global)
    assert.deepEqual(memory.anchors, [{ type: 'command', command: 'pnpm install' }])
    await assert.rejects(w.remember({ text: 'Prefer pnpm over npm in every project', scope: 'user', anchors: [{ type: 'file', path: 'package.json' }] }, w.global), /takes no file anchor/)
    w.close()
  })
})

describe('the graph', () => {
  test('an anchored memory joins its symbol, the symbol its file, and the file its directories', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS, anchors: [{ type: 'symbol', path: 'src/lib/db.ts', symbol: 'connect' }] })
    assert.deepEqual(w.edges(), [
      'dir:src/lib related_to dir:src',
      'file:src/lib/db.ts related_to dir:src/lib',
      `mem:${memory.id} about_symbol symbol:src/lib/db.ts#connect`,
      'symbol:src/lib/db.ts#connect related_to file:src/lib/db.ts',
    ])
    w.close()
  })

  test('an about edge weighs as much as the memory is trusted', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS, confidence: 0.9, anchors: [{ type: 'file', path: 'src/app.ts' }] })
    const row = w.project.db.prepare("SELECT weight FROM edges WHERE from_node = ? AND relation = 'about_file'").get(`mem:${memory.id}`) as { weight: number }
    assert.equal(row.weight, 0.9)
    w.close()
  })

  test('an id taken out of supersedes loses its edge', async () => {
    const w = world()
    const a = await w.remember({ text: 'Deploys go through the staging branch before production' })
    const b = await w.remember({ text: 'Integration tests run against a disposable Postgres container' })
    const c = await w.remember({ text: 'Releases are cut from the main branch every Tuesday morning', contradicts: [a.memory.id, b.memory.id] })
    await w.run(op => updateMemory(op, { id: c.memory.id, patch: { contradicts: [b.memory.id] } }))
    const edges = w.edges().filter(edge => edge.includes('contradicts'))
    assert.deepEqual(edges, [`mem:${c.memory.id} contradicts mem:${b.memory.id}`])
    w.close()
  })

  test('a memory that is no longer live loses its anchor edges', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS, anchors: [{ type: 'file', path: 'src/app.ts' }] })
    await w.run(op => updateMemory(op, { id: memory.id, patch: { status: 'archived' } }))
    assert.equal(w.edges().filter(edge => edge.startsWith(`mem:${memory.id}`)).length, 0)
    w.close()
  })
})

describe('usage counters', () => {
  test('a reminder and a use count in the record without moving its revision or clock', async () => {
    const w = world()
    const { memory } = await w.remember({ text: MIGRATIONS })
    await w.run(op => recordReminder(op, [memory.id, memory.id], 'tool_batch', 's1'))
    await w.run(op => recordUse(op, [memory.id], 'answer', 's1'))
    const stored = w.read(memory.id)
    assert.equal(stored.reminderCount, 1, 'one id counts once per call')
    assert.equal(stored.useCount, 1)
    assert.ok(stored.lastAccessedAt !== undefined && stored.lastUsedAt !== undefined)
    assert.equal(stored.revision, memory.revision)
    assert.equal(stored.updatedAt, memory.updatedAt)
    w.close()
  })
})
