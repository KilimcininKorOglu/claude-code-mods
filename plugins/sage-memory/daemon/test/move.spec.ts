import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readMemory } from '../rows.ts'
import { dropMemory, insertMoved, movedMemory, removeMoved } from '../move.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

const TEXT = 'Prefer pnpm over npm in every project'

test('a source changed after the move read it is not removed, and the copy can be taken out of the target again', async () => {
  const w = world()
  try {
    const { memory } = await w.remember({ text: TEXT, kind: 'preference' })
    const moved = await w.run(op => movedMemory(op, w.op(w.global), { id: memory.id, patch: { scope: 'user' } }))
    await w.run(op => insertMoved(op, moved, 'project', undefined), w.global)
    await w.run(op => updateMemory(op, { id: memory.id, patch: { importance: 0.9 } }))
    await assert.rejects(
      w.run(op => removeMoved(op, moved, 'user', undefined)),
      { message: `${memory.id} changed while it moved; try the scope change again` },
    )
    assert.equal(w.read(memory.id).importance, 0.9, 'the change made during the move is kept')
    await w.run(op => dropMemory(op, memory.id), w.global)
    assert.equal(readMemory(w.global.db, memory.id), undefined)
  } finally {
    w.close()
  }
})

test('an id the target holds already is refused', async () => {
  const w = world()
  try {
    const { memory } = await w.remember({ text: TEXT, kind: 'preference' })
    const moved = await w.run(op => movedMemory(op, w.op(w.global), { id: memory.id, patch: { scope: 'user' } }))
    await w.run(op => insertMoved(op, moved, 'project', undefined), w.global)
    await assert.rejects(w.run(op => insertMoved(op, moved, 'project', undefined), w.global), { message: `the user store holds ${memory.id} already` })
  } finally {
    w.close()
  }
})
