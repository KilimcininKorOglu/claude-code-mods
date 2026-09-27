import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { after, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { createStores, serial } from '../stores.ts'
import { cleanUp, tempDir } from './support.ts'

after(cleanUp)

const REF: ProjectRef = { key: 'demo-1a2b3c4d', name: 'demo', root: '/work/demo', commonDir: '/work/demo/.git' }

function projectFile(dir: string): { key: string; root: string } {
  return JSON.parse(readFileSync(`${dir}/${REF.key}/project.json`, 'utf8')) as { key: string; root: string }
}

describe('stores', () => {
  test('a project store lives in its own directory, with the project it belongs to', () => {
    const dir = tempDir()
    const stores = createStores(dir)
    try {
      const store = stores.project(REF)
      assert.equal(store.file, `${dir}/${REF.key}/sage.db`)
      assert.ok(existsSync(store.file))
      assert.equal(projectFile(dir).root, '/work/demo')
      stores.project({ ...REF, root: '/work/demo-worktree' })
      assert.equal(projectFile(dir).root, '/work/demo-worktree', 'a worktree of the same repository records its root')
      assert.deepEqual(stores.names(), [REF.key])
    } finally {
      stores.closeAll()
    }
  })

  test('a key that is not one safe path segment is refused', () => {
    const stores = createStores(tempDir())
    for (const key of ['', '..', '../x', 'a/b', '.hidden', 'x'.repeat(101)]) {
      assert.throws(() => stores.project({ ...REF, key }), /not a project key/, JSON.stringify(key))
    }
  })

  test('the global store is one file beside the project directories', () => {
    const dir = tempDir()
    const stores = createStores(dir)
    try {
      assert.equal(stores.global().file, `${dir}/global.db`)
      assert.equal(stores.global(), stores.global(), 'one connection per store')
    } finally {
      stores.closeAll()
    }
  })

  test('queued writes run one after another, and a failed write does not stop the queue', async () => {
    const stores = createStores(tempDir())
    const store = stores.global()
    try {
      const order: string[] = []
      const slow = serial(store, async () => {
        await sleep(20)
        order.push('slow')
      })
      const failed = serial(store, () => {
        throw new Error('the write failed')
      })
      const fast = serial(store, () => {
        order.push('fast')
        return 'done'
      })
      assert.equal(store.pending, 3)
      await slow
      await assert.rejects(failed, /the write failed/)
      assert.equal(await fast, 'done')
      assert.deepEqual(order, ['slow', 'fast'])
      assert.equal(store.pending, 0)
    } finally {
      stores.closeAll()
    }
  })

  test('an idle store closes, and a store with a queued write stays open', async () => {
    const stores = createStores(tempDir())
    const project = stores.project(REF)
    stores.global()
    let finish: (() => void) | undefined
    const held = serial(
      project,
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    try {
      await sleep(5)
      assert.ok(finish, 'the queued write runs')
      const later = Date.now() + 60_000
      assert.equal(stores.closeIdle(later, 1000), 1)
      assert.deepEqual(stores.names(), [REF.key])
      finish?.()
      await held
      assert.equal(stores.closeIdle(later, 1000), 1)
      assert.deepEqual(stores.names(), [])
    } finally {
      finish?.()
      stores.closeAll()
    }
  })
})
