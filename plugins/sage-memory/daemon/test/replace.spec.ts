import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import type { Memory } from '../../hooks/shared/model.ts'
import { insertMoved, movedMemory, removeMoved } from '../move.ts'
import { recoverMemory } from '../recover.ts'
import { deleteMemory } from '../remove.ts'
import { rankForTools } from '../remind.ts'
import { longMemories, replaceMemory, shortenFailed } from '../replace.ts'
import { remember } from '../remember.ts'
import { writeMemory } from '../rows.ts'
import { EVERY_POLICY, searchStore } from '../search.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

/** 251 characters: one past what a memory holds. */
const OVER = `Deploys go through the staging branch first. ${'x'.repeat(251 - 'Deploys go through the staging branch first. '.length)}`
/** 250 characters: what a memory holds. */
const AT = OVER.slice(0, 250)

/** A note written before the limit: stored as a short one, then given its old long text as a release before 0.4.0 left it. */
async function oldLong(w: World, text: string, fields: Partial<Memory> = {}): Promise<Memory> {
  const short = (await w.remember({ text: 'A placeholder written before the old text', tags: ['deploy'], anchors: [{ type: 'file', path: 'src/app.ts' }] })).memory
  const long: Memory = { ...short, ...fields, text }
  await w.run(op => writeMemory(op.store.db, long))
  return w.read(short.id)
}

const LONG_TEXT =
  'The release pipeline runs `make check` before each deploy, and a failed check stops it. ' +
  'Deploys go through the staging branch first; staging keeps 3 replicas. ' +
  'The rollback command is `deploy.sh --rollback`, measured at 40 s on 2026-11-15. ' +
  'The release log is kept in `logs/release.log` for 30 days.'

const PARTS = [
  'The release pipeline runs `make check` before each deploy, and a failed check stops the deploy.',
  'Deploys go through the staging branch first; staging keeps 3 replicas.',
  'The deploy rollback command is `deploy.sh --rollback`, measured at 40 s on 2026-11-15.',
  'The release log is kept in `logs/release.log` for 30 days.',
]

describe('the 250-character limit', () => {
  test('a memory of 251 characters is refused with the limit and its length; one of 250 is written', async () => {
    const w = world()
    await assert.rejects(w.remember({ text: OVER }), /the text is 251 characters; a memory holds at most 250/)
    assert.equal((await w.remember({ text: AT })).memory.text.length, 250)
    w.close()
  })

  test('an update that makes a memory longer than 250 characters is refused', async () => {
    const w = world()
    const memory = (await w.remember({ text: 'Deploys go through the staging branch first.' })).memory
    await assert.rejects(w.run(op => updateMemory(op, { id: memory.id, patch: { text: OVER } })), /a memory holds at most 250/)
    w.close()
  })

  test('an old memory longer than the limit still takes a tag update, a deletion, a recovery and a move', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT)
    await w.run(op => updateMemory(op, { id: old.id, patch: { tags: ['release'] } }))
    assert.deepEqual(w.read(old.id).tags, ['release'])
    await w.run(op => deleteMemory(op, { id: old.id, reason: 'test', force: true }))
    await w.run(op => recoverMemory(op, { id: old.id, reason: 'test' }))
    assert.equal(w.read(old.id).status, 'active')
    const request = { id: old.id, patch: { scope: 'user' as const } }
    const moved = await w.run(source => movedMemory(source, w.op(w.global), request))
    await w.run(target => insertMoved(target, moved, 'project', undefined), w.global)
    await w.run(source => removeMoved(source, moved, 'global', undefined))
    assert.equal(w.read(old.id, w.global).text, LONG_TEXT)
    w.close()
  })
})

describe('replacing a long memory with shorter ones', () => {
  test('the parts carry the old fields, the old memory is superseded by the first and is found no more', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT, { importance: 0.95, persistence: 'permanent', kind: 'workflow' })
    const result = await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    assert.deepEqual(result.parts.map(part => part.text), PARTS)
    for (const part of result.parts) {
      assert.deepEqual([part.kind, part.importance, part.persistence, part.tags, part.anchors], ['workflow', 0.95, 'permanent', ['deploy'], [{ type: 'file', path: 'src/app.ts' }]])
    }
    const after = w.read(old.id)
    assert.deepEqual([after.status, after.supersededBy], ['superseded', result.parts[0]!.id])
    const visible = { statuses: ['active'] as const, policies: EVERY_POLICY, audienceScoped: true }
    assert.deepEqual(searchStore(w.project.db, 'rollback', { ...visible, statuses: ['active'] }, 10).map(memory => memory.id), [result.parts[2]!.id])
    w.close()
  })

  test('the parts of a stale memory stay stale with its reason', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT, { status: 'stale', staleReason: 'verification' })
    const result = await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    for (const part of result.parts) assert.deepEqual([w.read(part.id).status, w.read(part.id).staleReason], ['stale', 'verification'])
    w.close()
  })

  test('a recover of the old id answers the first part and leaves the old text in the store', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT)
    const result = await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    const recovered = await w.run(op => recoverMemory(op, { id: old.id }))
    assert.deepEqual([recovered.memory.id, recovered.noop], [result.parts[0]!.id, true])
    assert.equal(w.read(old.id).text, LONG_TEXT)
    w.close()
  })

  test('every part names the old memory in supersedes and keeps its related and contradicts', async () => {
    const w = world()
    const friend = (await w.remember({ text: 'The release pipeline posts its log to the team channel' })).memory
    const rival = (await w.remember({ text: 'Deploys skip staging on Fridays', distinct: true })).memory
    const old = await oldLong(w, LONG_TEXT, { related: [friend.id], contradicts: [rival.id] })
    const result = await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    for (const part of result.parts) assert.deepEqual([part.supersedes, part.related, part.contradicts], [[old.id], [friend.id], [rival.id]])
    w.close()
  })

  test('parts that leave out a name, a path or a date of the old text are refused, and nothing is written', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT)
    const dropped = [PARTS[0]!, PARTS[1]!, 'The deploy rollback command is `deploy.sh --rollback`.', PARTS[3]!]
    await assert.rejects(w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: dropped })), /leave out 2026-11-15/)
    assert.equal(w.read(old.id).status, 'active')
    assert.equal(longMemories(w.op(), 10, '0.4.0').length, 1)
    w.close()
  })

  test('a part over 250 characters, no part, or a changed memory is refused', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT)
    await assert.rejects(w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: [...PARTS, OVER] })), /at most 250/)
    await assert.rejects(w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: [] })), /at least one text/)
    await assert.rejects(w.run(op => replaceMemory(op, { id: old.id, revision: old.revision + 1, texts: PARTS })), /changed since it was read/)
    w.close()
  })

  test('two writers of the same memory: the second finds it replaced and writes nothing', async () => {
    const w = world()
    const old = await oldLong(w, LONG_TEXT)
    await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    await assert.rejects(w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS })), /is not a live memory/)
    w.close()
  })

  test('the long memories are the live ones over 250 characters, weightiest first', async () => {
    const w = world()
    const low = await oldLong(w, LONG_TEXT, { importance: 0.4 })
    const high = await oldLong(w, `${LONG_TEXT} The second copy is weightier.`, { importance: 0.8 })
    await w.remember({ text: AT })
    const gone = await oldLong(w, `${LONG_TEXT} A deleted copy.`)
    await w.run(op => deleteMemory(op, { id: gone.id, reason: 'test', force: true }))
    assert.deepEqual(longMemories(w.op(), 10, '0.4.0').map(memory => memory.id), [high.id, low.id])
    w.close()
  })

  test('a memory whose rewrite failed three times under a version waits for the next version; one another window holds is skipped', async () => {
    const w = world()
    const first = await oldLong(w, LONG_TEXT, { importance: 0.9 })
    const second = await oldLong(w, `${LONG_TEXT} A second copy.`, { importance: 0.5 })
    const fail = (version: string) => w.run(op => shortenFailed(op, { id: first.id, reason: 'lost a date', version }))
    const handed = (version: string) => longMemories(w.op(), 10, version).map(memory => memory.id)
    for (let i = 0; i < 2; i++) await fail('0.4.0')
    assert.deepEqual(handed('0.4.0'), [first.id, second.id], 'two failures: still handed out')
    await fail('0.4.0')
    assert.deepEqual(handed('0.4.0'), [second.id], 'three failures: left as it is')
    assert.deepEqual(handed('0.4.1'), [first.id, second.id], 'the next version tries it again')
    assert.deepEqual(longMemories(w.op(), 10, '0.4.0', id => id === second.id), [], 'a memory another window holds is skipped')
    await assert.rejects(w.run(op => shortenFailed(op, { id: 'no-such-id', reason: 'x', version: '0.4.0' })), /not a memory of this store/)
    w.close()
  })

  test('the parts of one split memory do not fill a file block: each other memory of the file comes before a second part', async () => {
    const w = world()
    const own = [
      (await w.remember({ text: 'The app entry point reads its port from the environment', anchors: [{ type: 'file', path: 'src/app.ts' }], importance: 0.6 })).memory,
      (await w.remember({ text: 'Every request handler in the app logs its duration', anchors: [{ type: 'file', path: 'src/app.ts' }], importance: 0.6, distinct: true })).memory,
    ]
    const old = await oldLong(w, LONG_TEXT, { importance: 0.9 })
    const { parts } = await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    const ranked = rankForTools(w.readers('s', 'main'), { paths: [`${w.root}/src/app.ts`], query: 'src app ts', mutation: false, limit: 8 }).candidates.map(c => c.memory.id)
    const partIds = new Set(parts.map(part => part.id))
    const firstThree = ranked.slice(0, 3)
    assert.ok(own.every(memory => firstThree.includes(memory.id)), 'both other memories of the file are among the first three')
    assert.equal(firstThree.filter(id => partIds.has(id)).length, 1, 'one part of the split memory is among the first three')
    assert.deepEqual(new Set(ranked.filter(id => partIds.has(id))), partIds, 'no part is dropped')
    w.close()
  })

  test('a part that repeats a live memory word for word joins it', async () => {
    const w = world()
    const existing = (await w.remember({ text: PARTS[1]! })).memory
    const old = await oldLong(w, LONG_TEXT)
    const result = await w.run(op => replaceMemory(op, { id: old.id, revision: old.revision, texts: PARTS }))
    assert.equal(result.parts[1]!.id, existing.id)
    assert.equal(remember(w.op(), { text: PARTS[0]!, distinct: true }).outcome, 'merged')
    w.close()
  })
})
