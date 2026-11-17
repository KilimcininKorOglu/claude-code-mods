import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import type { Memory } from '../../hooks/shared/model.ts'
import { writeDays } from '../../hooks/shared/days.ts'
import { datedMemories, MAX_REDATE_TRIES, redateFailed, redateMemory } from '../redate.ts'
import { writeMemory } from '../rows.ts'
import { cleanUp } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const CREATED = '2026-11-16T07:30:00.000Z'

/** A memory written on 2026-11-16 whose text is `text`. */
async function dated(w: World, text: string): Promise<Memory> {
  const memory = (await w.remember({ text, tags: ['deploy'], anchors: [{ type: 'file', path: 'src/app.ts' }] })).memory
  await w.run(op => writeMemory(op.store.db, { ...memory, createdAt: CREATED }))
  return w.read(memory.id)
}

describe('write days', () => {
  test('a date within a day of the creation is a write day, in either form; any other date is part of the fact', () => {
    const memory = { createdAt: CREATED, text: 'Kerem chose (2026-11-16) and confirmed on 17.11.2026; the key expires on 2026-12-31 and was issued 2026-11-14.' }
    assert.deepEqual(writeDays(memory), ['2026-11-16', '17.11.2026'])
    assert.deepEqual(writeDays({ createdAt: CREATED, text: 'Deploys go through staging; no date here.' }), [])
    assert.deepEqual(writeDays({ createdAt: CREATED, text: 'A day that does not exist: 2026-02-31.' }), [])
  })
})

describe('taking the write day out of a memory', () => {
  test('the text loses its write day and keeps id, anchors, creation time and the fact date', async () => {
    const w = world()
    const old = await dated(w, 'Kerem chose (2026-11-16): the vendor key in `config/keys.ts` expires on 2026-12-31.')
    const text = 'Kerem chose: the vendor key in `config/keys.ts` expires on 2026-12-31.'
    const memory = await w.run(op => redateMemory(op, { id: old.id, revision: old.revision, text }))
    assert.deepEqual([memory.id, memory.text, memory.createdAt, memory.anchors], [old.id, text, CREATED, old.anchors])
    w.close()
  })

  test('a text that drops a fact date, drops another name, adds a name, or keeps the write day is refused', async () => {
    const w = world()
    const old = await dated(w, 'Kerem chose (2026-11-16): the vendor key in `config/keys.ts` expires on 2026-12-31.')
    const tries: Array<[string, RegExp]> = [
      ['Kerem chose: the vendor key in `config/keys.ts` expires soon.', /leaves out 2026-12-31/],
      ['Kerem chose: the vendor key expires on 2026-12-31.', /leaves out config\/keys.ts/],
      ['Kerem chose: the vendor key in `config/keys.ts` and `config/old.ts` expires on 2026-12-31.', /adds config\/old.ts/],
      ['Kerem chose on 2026-11-16: the vendor key in `config/keys.ts` expires on 2026-12-31.', /still holds 2026-11-16/],
    ]
    for (const [text, refusal] of tries) await assert.rejects(w.run(op => redateMemory(op, { id: old.id, revision: old.revision, text })), refusal)
    assert.equal(w.read(old.id).text, old.text)
    w.close()
  })

  test('a memory changed since it was read is refused', async () => {
    const w = world()
    const old = await dated(w, 'Deploys were moved to Flyway on 2026-11-16.')
    await assert.rejects(w.run(op => redateMemory(op, { id: old.id, revision: old.revision + 1, text: 'Deploys were moved to Flyway.' })), /changed since it was read/)
    w.close()
  })

  test('the job is handed only memories with a write day, and a memory that failed its tries waits for the next version', async () => {
    const w = world()
    const withDay = await dated(w, 'Migrations use Flyway, decided 2026-11-16.')
    await dated(w, 'The vendor key expires on 2026-12-31.')
    assert.deepEqual(await w.run(op => datedMemories(op, 10, '1.0.0').map(memory => memory.id)), [withDay.id])
    for (let i = 0; i < MAX_REDATE_TRIES; i++) await w.run(op => redateFailed(op, { id: withDay.id, reason: 'no answer', version: '1.0.0' }))
    assert.deepEqual(await w.run(op => datedMemories(op, 10, '1.0.0')), [])
    assert.deepEqual(await w.run(op => datedMemories(op, 10, '1.0.1').map(memory => memory.id)), [withDay.id])
    w.close()
  })
})
