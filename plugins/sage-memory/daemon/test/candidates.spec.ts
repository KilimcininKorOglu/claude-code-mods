import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import type { ProposeInput } from '../../hooks/shared/model.ts'
import { accept, listCandidates, propose, reject, resolve } from '../candidates.ts'
import { deleteMemory } from '../remove.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const FACT = 'Integration tests run against a disposable Postgres container'

function review(w: World, targetMemoryId: string, suggestedAction: ProposeInput['suggestedAction']) {
  return w.run(op => propose(op, { text: 'This memory was reminded ten times and never used', targetMemoryId, reviewReason: 'reminded_never_used', suggestedAction }))
}

describe('proposals', () => {
  test('a proposal opens pending with the defaults, and the same one is not opened twice', async () => {
    const w = world()
    const first = await w.run(op => propose(op, { text: FACT }))
    assert.deepEqual([first.status, first.kind, first.scope, first.confidence, first.importance], ['pending', 'fact', 'project', 0.6, 0.6])
    assert.match(first.id, /^candidate_/)
    const again = await w.run(op => propose(op, { text: `${FACT}.` }))
    assert.equal(again.id, first.id)
    w.close()
  })

  test('a proposal takes anchors, so a file note can be proposed', async () => {
    const w = world()
    const candidate = await w.run(op => propose(op, { text: 'The router mounts every page under /app', kind: 'file_note', anchors: [{ type: 'file', path: 'src/app.ts' }] }))
    assert.deepEqual(candidate.anchors, [{ type: 'file', path: 'src/app.ts' }])
    w.close()
  })

  test('a proposal follows the rules remember writes by', async () => {
    const w = world()
    await assert.rejects(w.run(op => propose(op, { text: 'TODO fix the flaky test' })), /progress chatter/)
    await assert.rejects(w.run(op => propose(op, { text: 'deploy key ghp_abcdefghijklmnopqrstuvwxyz0123' })), /secret/)
    w.close()
  })

  test('accepting a proposal writes its memory and closes it in one step', async () => {
    const w = world()
    const candidate = await w.run(op => propose(op, { text: FACT, tags: ['tests'] }))
    const accepted = await w.run(op => accept(op, candidate.id))
    assert.ok(accepted.memory)
    assert.equal(accepted.candidate.status, 'accepted')
    assert.equal(accepted.candidate.memoryId, accepted.memory.id)
    assert.deepEqual(w.read(accepted.memory.id).tags, ['tests'])
    assert.equal((await w.run(op => accept(op, candidate.id))).alreadyResolved, true)
    w.close()
  })

  test('rejecting closes a pending proposal once', async () => {
    const w = world()
    const candidate = await w.run(op => propose(op, { text: FACT }))
    assert.equal(await w.run(op => reject(op, { id: candidate.id, reason: 'not durable' })), true)
    assert.equal(await w.run(op => reject(op, { id: candidate.id, reason: 'again' })), false)
    const [closed] = await w.run(op => listCandidates(op, true))
    assert.deepEqual([closed?.status, closed?.reason], ['rejected', 'not durable'])
    assert.deepEqual(await w.run(op => listCandidates(op, false)), [])
    w.close()
  })
})

describe('reviews', () => {
  test('a proposal that names a live memory is a review of it', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT })
    const candidate = await review(w, memory.id, 'investigate')
    assert.equal(candidate.kind, 'memory_review')
    assert.equal(candidate.targetMemoryId, memory.id)
    await assert.rejects(review(w, 'NOPE', 'delete'), /NOPE is not a live memory/)
    await assert.rejects(w.run(op => propose(op, { text: 'Review without a target', kind: 'memory_review' })), /names the memory it reviews/)
    w.close()
  })

  test('accepting a review that suggests investigate decides nothing, and the memory stays', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT })
    const candidate = await review(w, memory.id, 'investigate')
    await assert.rejects(w.run(op => accept(op, candidate.id)), /suggests investigate, so accepting it decides nothing/)
    assert.equal(w.read(memory.id).status, 'active')
    assert.equal((await w.run(op => listCandidates(op, false))).length, 1, 'the review stays pending')
    w.close()
  })

  test('accepting a review applies the decision it suggests', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT })
    const candidate = await review(w, memory.id, 'archive')
    const accepted = await w.run(op => accept(op, candidate.id))
    assert.equal(accepted.resolution?.applied, true)
    assert.equal(w.read(memory.id).status, 'archived')
    w.close()
  })

  test('a delete decision leaves a permanent target alone and still closes the review', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT, persistence: 'permanent' })
    const candidate = await review(w, memory.id, 'delete')
    const resolution = await w.run(op => resolve(op, { id: candidate.id, decision: 'delete' }))
    assert.equal(resolution.applied, false)
    assert.equal(w.read(memory.id).status, 'active')
    assert.equal((await w.run(op => listCandidates(op, false))).length, 0)
    w.close()
  })

  test('keep closes the review as rejected and leaves the memory', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT })
    const candidate = await review(w, memory.id, 'delete')
    const resolution = await w.run(op => resolve(op, { id: candidate.id, decision: 'keep', reason: 'still true' }))
    assert.equal(resolution.applied, true)
    const [closed] = await w.run(op => listCandidates(op, true))
    assert.deepEqual([closed?.status, closed?.reason], ['rejected', 'still true'])
    assert.equal(w.read(memory.id).status, 'active')
    w.close()
  })

  test('a review whose target was deleted meanwhile closes without touching the tombstone', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT })
    const candidate = await review(w, memory.id, 'archive')
    await w.run(op => deleteMemory(op, { id: memory.id, reason: 'gone', force: true }))
    const resolution = await w.run(op => resolve(op, { id: candidate.id, decision: 'archive' }))
    assert.equal(resolution.applied, false)
    assert.equal(w.read(memory.id).status, 'deleted', 'archiving would have brought the tombstone back')
    assert.equal((await w.run(op => resolve(op, { id: candidate.id, decision: 'archive' }))).alreadyResolved, true)
    w.close()
  })

  test('a delete decision on a live target deletes it', async () => {
    const w = world()
    const { memory } = await w.remember({ text: FACT })
    await w.run(op => updateMemory(op, { id: memory.id, patch: { status: 'stale' } }))
    const candidate = await review(w, memory.id, 'delete')
    assert.equal((await w.run(op => resolve(op, { id: candidate.id, decision: 'delete' }))).applied, true)
    assert.equal(w.read(memory.id).status, 'deleted')
    w.close()
  })

  test('only a review is resolved', async () => {
    const w = world()
    const candidate = await w.run(op => propose(op, { text: FACT }))
    await assert.rejects(w.run(op => resolve(op, { id: candidate.id, decision: 'delete' })), /accept or reject it, only a review is resolved/)
    w.close()
  })
})
