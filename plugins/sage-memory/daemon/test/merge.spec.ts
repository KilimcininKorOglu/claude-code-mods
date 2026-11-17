import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { after, describe, test } from 'node:test'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { ownerOf } from '../merge.ts'
import { canonical } from '../nested.ts'
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
    assert.deepEqual(merged.map(row => JSON.parse(row.detail) as unknown), [{ from: 'repo-0000aaaa', root: w.root, copied: 1 }])
    w.close()
  })

  // The user's rule: a git repository inside a project folder (tosbisim-clone/client-ios) keeps one store with that project.
  test('a store above a session folder owns it, and takes in the folder store with its file anchors rebased onto its own root', async () => {
    const w = world()
    mkdirSync(`${w.root}/client-ios`)
    const childRef: ProjectRef = { key: 'client-ios-3333dddd', name: 'client-ios', root: `${w.root}/client-ios`, commonDir: `${w.root}/client-ios/.git` }
    const child = w.stores.project(childRef)
    const note = (await w.remember({ text: 'The watch screen lives in Watch/WatchStore.swift.', anchors: [{ type: 'file', path: 'src/app.ts' }] }, child)).memory
    const parentRef: ProjectRef = { key: 'repo-0000aaaa', name: 'repo', root: w.root, commonDir: `${w.root}/.git` }
    assert.deepEqual(ownerOf(childRef, [parentRef, childRef]), parentRef)
    assert.equal(ownerOf(parentRef, [parentRef, childRef]), undefined)
    assert.equal(ownerOf(childRef, [{ ...parentRef, root: dirname(dirname(w.root)) }, childRef], canonical(dirname(w.root))), undefined, 'the home directory owns no project')
    w.stores.closeAll()
    const store = w.stores.project({ ...parentRef, root: `${w.root}/` })
    assert.deepEqual(readMemory(store.db, note.id)?.anchors.map(anchor => anchor.path), ['client-ios/src/app.ts'])
    assert.equal(existsSync(dirname(child.file)), false)
    w.stores.closeAll()
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
