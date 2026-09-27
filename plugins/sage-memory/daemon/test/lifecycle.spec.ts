import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { backfill, recoverMemory } from '../recover.ts'
import { clear, deleteMemory, forget } from '../remove.ts'
import { audit, readAudit } from '../rows.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const DEPLOYS = 'Deploys go through the staging branch before production'
const POOL = 'The connection pool keeps twenty sockets for each worker'
const RELEASES = 'Releases are cut from the main branch every Tuesday morning'

async function three(w: World): Promise<[string, string, string]> {
  const a = await w.remember({ text: DEPLOYS, tags: ['deploy'] })
  const b = await w.remember({ text: POOL, anchors: [{ type: 'file', path: 'src/app.ts' }] })
  const c = await w.remember({ text: RELEASES })
  return [a.memory.id, b.memory.id, c.memory.id]
}

describe('update', () => {
  test('only the named fields change, and the revision and clock move on', async () => {
    const w = world()
    const [id] = await three(w)
    const before = w.read(id)
    const { memory } = await w.run(op => updateMemory(op, { id, patch: { tags: ['#Release'], importance: 1.4, contextPolicy: 'always' } }))
    assert.deepEqual(memory.tags, ['release'])
    assert.equal(memory.importance, 1, 'a score is clamped to 0..1')
    assert.equal(memory.contextPolicy, 'always')
    assert.equal(memory.text, before.text)
    assert.equal(memory.revision, before.revision + 1)
    assert.ok(memory.updatedAt > before.updatedAt)
    w.close()
  })

  test('a status set by a patch is a decision: stale is manual or review, and leaving superseded drops the successor', async () => {
    const w = world()
    const [a, b] = await three(w)
    assert.equal((await w.run(op => updateMemory(op, { id: a, patch: { status: 'stale' } }))).memory.staleReason, 'manual')
    assert.equal((await w.run(op => updateMemory(op, { id: a, patch: { status: 'stale', staleReason: 'review' } }))).memory.staleReason, 'review')
    await w.run(op => updateMemory(op, { id: b, patch: { status: 'superseded', supersededBy: a } }))
    assert.equal(w.read(b).supersededBy, a)
    const back = await w.run(op => updateMemory(op, { id: b, patch: { status: 'active' } }))
    assert.equal(back.memory.supersededBy, undefined)
    assert.equal(back.memory.staleReason, undefined)
    w.close()
  })

  test('a successor must be live, and a supersededBy goes with status superseded', async () => {
    const w = world()
    const [a, b] = await three(w)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { supersededBy: b } })), /supersededBy goes with status superseded/)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { status: 'superseded', supersededBy: 'NOPE' } })), /not a live memory/)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { status: 'superseded', supersededBy: a } })), /cannot supersede itself/)
    w.close()
  })

  test('scope and session never change, and an empty patch is refused', async () => {
    const w = world()
    const [a] = await three(w)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { scope: 'user' } as never })), /takes no scope/)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: {} })), /changes nothing/)
    w.close()
  })

  test('a new supersedes entry moves its target to superseded', async () => {
    const w = world()
    const [a, b] = await three(w)
    const { superseded } = await w.run(op => updateMemory(op, { id: b, patch: { supersedes: [a] } }))
    assert.deepEqual(superseded, [a])
    assert.equal(w.read(a).status, 'superseded')
    assert.equal(w.read(a).supersededBy, b)
    w.close()
  })

  test("another session's session memory is refused to a session, and the person may change it", async () => {
    const w = world()
    const { memory } = await w.remember({ text: DEPLOYS, scope: 'session', ownerSessionId: 's1' })
    await assert.rejects(w.run(op => updateMemory(op, { id: memory.id, patch: { importance: 0.9 }, sessionId: 's2' })), /session memory of another session/)
    assert.equal((await w.run(op => updateMemory(op, { id: memory.id, patch: { importance: 0.9 }, sessionId: 's1' }))).memory.importance, 0.9)
    assert.equal((await w.run(op => updateMemory(op, { id: memory.id, patch: { importance: 0.8 } }))).memory.importance, 0.8)
    w.close()
  })

  test('deleting through a patch needs force and takes nothing else, and a tombstone takes no patch', async () => {
    const w = world()
    const [a] = await three(w)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { status: 'deleted' } })), /needs force/)
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { status: 'deleted', force: true, importance: 0.1 } })), /takes force and nothing else, not importance/)
    const { memory } = await w.run(op => updateMemory(op, { id: a, patch: { status: 'deleted', force: true } }))
    assert.equal(memory.status, 'deleted')
    await assert.rejects(w.run(op => updateMemory(op, { id: a, patch: { importance: 0.9 } })), /is deleted; recover it/)
    w.close()
  })
})

describe('delete', () => {
  test('a delete needs force, a permanent memory refuses anything less, and the row stays as a tombstone', async () => {
    const w = world()
    const [a] = await three(w)
    await assert.rejects(w.run(op => deleteMemory(op, { id: a, reason: 'test' })), /needs force/)
    await w.run(op => updateMemory(op, { id: a, patch: { persistence: 'permanent' } }))
    await assert.rejects(w.run(op => deleteMemory(op, { id: a, reason: 'test', review: true })), /is permanent/)
    assert.equal(await w.run(op => deleteMemory(op, { id: a, reason: 'test', force: true })), true)
    assert.equal(w.read(a).status, 'deleted')
    assert.equal(await w.run(op => deleteMemory(op, { id: a, reason: 'again', force: true })), false, 'a tombstone is deleted once')
    w.close()
  })

  test('a deleted memory leaves every relationship and edge that named it', async () => {
    const w = world()
    const [a, b, c] = await three(w)
    await w.run(op => updateMemory(op, { id: c, patch: { contradicts: [a, b] } }))
    await w.run(op => updateMemory(op, { id: b, patch: { status: 'superseded', supersededBy: a } }))
    await w.run(op => deleteMemory(op, { id: a, reason: 'wrong', force: true }))
    assert.deepEqual(w.read(c).contradicts, [b])
    assert.equal(w.read(b).supersededBy, undefined)
    assert.deepEqual(w.edges().filter(edge => edge.includes(`mem:${a}`)), [])
    w.close()
  })

  test('neverRemind keeps a deleted memory out of every automatic path, and the audit log says why', async () => {
    const w = world()
    const [a] = await three(w)
    await w.run(op => deleteMemory(op, { id: a, reason: 'private', force: true, neverRemind: true, sessionId: 's1' }))
    assert.equal(w.read(a).contextPolicy, 'never')
    const [entry] = readAudit(w.project.db, 1)
    assert.equal(entry?.action, 'memory.deleted')
    assert.equal(entry?.memoryId, a)
    assert.equal(entry?.sessionId, 's1')
    assert.deepEqual((entry?.detail as { reason: string }).reason, 'private')
    w.close()
  })
})

describe('forget and clear', () => {
  test('forget needs a query of three characters and force, and matches text, tags and anchors', async () => {
    const w = world()
    const [a, b] = await three(w)
    await assert.rejects(w.run(op => forget(op, { query: 'de', scope: 'project', force: true })), /under 3 characters/)
    await assert.rejects(w.run(op => forget(op, { query: 'deploy', scope: 'project' })), /needs force/)
    const byTag = await w.run(op => forget(op, { query: 'DEPLOY', scope: 'project', force: true }))
    assert.deepEqual(byTag.removed, [a])
    const byAnchor = await w.run(op => forget(op, { query: 'src/app', scope: 'project', force: true }))
    assert.deepEqual(byAnchor.removed, [b])
    w.close()
  })

  test('forget skips a permanent memory', async () => {
    const w = world()
    const { memory } = await w.remember({ text: DEPLOYS, persistence: 'permanent' })
    const result = await w.run(op => forget(op, { query: 'staging', scope: 'project', force: true }))
    assert.deepEqual(result, { removed: [], skippedPermanent: [memory.id] })
    assert.equal(w.read(memory.id).status, 'active')
    w.close()
  })

  test("forget in the session scope reaches the caller's own session memories alone", async () => {
    const w = world()
    const mine = await w.remember({ text: DEPLOYS, scope: 'session', ownerSessionId: 's1' })
    const theirs = await w.remember({ text: DEPLOYS, scope: 'session', ownerSessionId: 's2' })
    await assert.rejects(w.run(op => forget(op, { query: 'staging', scope: 'session', force: true })), /needs the caller's session/)
    const result = await w.run(op => forget(op, { query: 'staging', scope: 'session', force: true, sessionId: 's1' }))
    assert.deepEqual(result.removed, [mine.memory.id])
    assert.equal(w.read(theirs.memory.id).status, 'active')
    w.close()
  })

  test('clear needs force and keeps permanent memories', async () => {
    const w = world()
    const [a, b, c] = await three(w)
    await w.run(op => updateMemory(op, { id: c, patch: { persistence: 'permanent' } }))
    await assert.rejects(w.run(op => clear(op, {})), /needs force/)
    const result = await w.run(op => clear(op, { force: true }))
    assert.deepEqual(result, { cleared: 2, skippedPermanent: [c] })
    assert.deepEqual([w.read(a).status, w.read(b).status, w.read(c).status], ['deleted', 'deleted', 'active'])
    w.close()
  })
})

describe('recover and backfill', () => {
  test('a tombstone comes back in place; an active memory and a superseded one answer the live memory', async () => {
    const w = world()
    const [a, b] = await three(w)
    await w.run(op => deleteMemory(op, { id: a, reason: 'oops', force: true }))
    const back = await w.run(op => recoverMemory(op, { id: a }))
    assert.equal(back.noop, false)
    assert.equal(back.memory.status, 'active')
    assert.equal((await w.run(op => recoverMemory(op, { id: a }))).noop, true)
    await w.run(op => updateMemory(op, { id: b, patch: { status: 'superseded', supersededBy: a } }))
    const head = await w.run(op => recoverMemory(op, { id: b }))
    assert.deepEqual([head.noop, head.memory.id], [true, a])
    w.close()
  })

  test('a superseded memory whose chain has no active end, and a stale one, are refused', async () => {
    const w = world()
    const [a, b] = await three(w)
    await w.run(op => updateMemory(op, { id: b, patch: { status: 'superseded', supersededBy: a } }))
    await w.run(op => updateMemory(op, { id: a, patch: { status: 'archived' } }))
    await assert.rejects(w.run(op => recoverMemory(op, { id: b })), /no active memory ends its chain/)
    await w.run(op => updateMemory(op, { id: a, patch: { status: 'stale' } }))
    await assert.rejects(w.run(op => recoverMemory(op, { id: a })), /is stale, which recover does not change/)
    w.close()
  })

  test('backfill reports without apply, and with apply brings a tombstone back as a new memory', async () => {
    const w = world()
    const [a] = await three(w)
    await w.run(op => deleteMemory(op, { id: a, reason: 'oops', force: true }))
    const dry = await w.run(op => backfill(op, {}))
    assert.deepEqual([dry.examined, dry.recoverable, dry.recovered], [1, 1, 0])
    assert.equal(w.read(a).status, 'deleted')
    const applied = await w.run(op => backfill(op, { apply: true }))
    const newId = applied.recoverableRecords[0]?.newActiveId
    assert.ok(newId)
    const revived = w.read(newId)
    assert.deepEqual([revived.status, revived.supersedes, revived.useCount, revived.reminderCount], ['active', [a], 0, 0])
    assert.ok(revived.tags.includes('backfill:recovered'))
    assert.equal(w.read(a).status, 'deleted', 'the tombstone stays')
    const again = await w.run(op => backfill(op, { apply: true }))
    assert.deepEqual(again.byReason, { already_recovered: 1 })
    const recovered = await w.run(op => recoverMemory(op, { id: a }))
    assert.deepEqual([recovered.noop, recovered.memory.id], [true, newId], 'recovering the tombstone answers its successor')
    w.close()
  })

  test('backfill leaves a tombstone whose knowledge is live again', async () => {
    const w = world()
    const [a] = await three(w)
    await w.run(op => deleteMemory(op, { id: a, reason: 'oops', force: true }))
    await w.remember({ text: DEPLOYS })
    const report = await w.run(op => backfill(op, { apply: true }))
    assert.deepEqual(report.byReason, { duplicate_active: 1 })
    w.close()
  })
})

describe('the audit log', () => {
  test('it keeps its newest thousand rows, cut every 256 writes', async () => {
    const w = world()
    await w.run(op => {
      for (let i = 0; i < 1300; i++) audit(op.store, op.now, 'test.row', { detail: { i } })
    })
    const count = (w.project.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n
    assert.ok(count >= 1000 && count < 1000 + 256, `${count} rows kept`)
    const [newest] = readAudit(w.project.db, 1)
    assert.deepEqual(newest?.detail, { i: 1299 })
    w.close()
  })
})
