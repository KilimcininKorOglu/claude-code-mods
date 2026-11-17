import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { after, describe, test } from 'node:test'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { readMemory, selectMemories } from '../rows.ts'
import { cleanUp } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

describe('one project folder in two stores', () => {
  // The user's report: a folder that became a git repository kept its notes in a store no session opened again.
  test('the store a session opens takes in the notes of the other store of its root, with their ids and dates, and the other directory is removed', async () => {
    const w = world()
    const before = (await w.remember({ text: 'Deploys go through staging before production.', tags: ['deploy'] })).memory
    const oldDir = dirname(w.project.file)
    const gitRef: ProjectRef = { key: 'repo-1111bbbb', name: 'repo', root: w.root, commonDir: `${w.root}/.git` }
    const store = w.stores.project(gitRef)
    const taken = readMemory(store.db, before.id)
    assert.deepEqual([taken?.text, taken?.createdAt], [before.text, before.createdAt])
    assert.equal(existsSync(oldDir), false)
    const merged = store.db.prepare("SELECT detail FROM audit_log WHERE action = 'store.merged'").all() as Array<{ detail: string }>
    assert.deepEqual(merged.map(row => JSON.parse(row.detail) as unknown), [{ from: 'repo-0000aaaa', copied: 1 }])
    w.close()
  })

  test('a memory the opened store already holds is not copied over, and a store of another root is left alone', async () => {
    const w = world()
    const shared = (await w.remember({ text: 'Staging resets every night.', tags: ['staging'] })).memory
    const gitRef: ProjectRef = { key: 'repo-1111bbbb', name: 'repo', root: w.root, commonDir: `${w.root}/.git` }
    const otherRef: ProjectRef = { key: 'other-2222cccc', name: 'other', root: `${w.root}-other`, commonDir: `${w.root}-other/.git` }
    const other = w.stores.project(otherRef)
    w.stores.closeAll()
    const store = w.stores.project(gitRef)
    assert.equal(selectMemories(store.db, 'SELECT id, data FROM memories').filter(memory => memory.id === shared.id).length, 1)
    assert.equal(existsSync(other.file), true)
    w.stores.closeAll()
  })
})
