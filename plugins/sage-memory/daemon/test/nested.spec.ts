import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { layoutOf } from '../../hooks/shared/layout.ts'
import type { Memory, Ranking, RememberWritten, SearchHit } from '../../hooks/shared/model.ts'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { call } from '../http.ts'
import { canonical, nestedRefs, rebase } from '../nested.ts'
import { startServer } from '../server.ts'
import { cleanUp, tempDir } from './support.ts'

after(cleanUp)

type Reply = { status: number; value: unknown; error: string | undefined }

/** A project at `base/<path>`, with a source file each store's anchors can name. */
function projectAt(base: string, path: string, key: string): ProjectRef {
  const root = join(base, path)
  mkdirSync(join(root, 'Sources'), { recursive: true })
  writeFileSync(join(root, 'Sources', 'App.swift'), 'struct App {}\n')
  return { key, name: path.split('/').at(-1)!, root, commonDir: root }
}

/**
 * A daemon and three projects: `app`, `app/client-ios` below it with a repository of its own, and
 * `web`, a sibling folder of `app`.
 */
async function withNested(work: (d: { app: ProjectRef; ios: ProjectRef; web: ProjectRef; value: <T>(path: string, body: object) => Promise<T>; ask: (path: string, body: object) => Promise<Reply> }) => Promise<void>): Promise<void> {
  const base = tempDir()
  const dir = join(base, 'data')
  const started = await startServer({ dir, version: '9.9.9', idleMs: 60_000 })
  if (!started.owned) throw new Error(`the daemon of pid ${started.hello.pid} kept the socket`)
  const ask =async (path: string, body: object): Promise<Reply> => {
    const answer = await call(layoutOf(dir).socket, path, { method: 'POST', token: started.token, body: JSON.stringify(body), timeoutMs: 5000 })
    const reply = answer.reply as { value?: unknown; error?: string }
    return { status: answer.status, value: reply.value, error: reply.error }
  }
  const value = async <T>(path: string, body: object): Promise<T> => {
    const reply = await ask(path, body)
    assert.equal(reply.status, 200, `${path}: ${reply.error ?? ''}`)
    return reply.value as T
  }
  try {
    await work({ app: projectAt(base, 'app', 'app-0000aaaa'), ios: projectAt(base, 'app/client-ios', 'client-ios-0000bbbb'), web: projectAt(base, 'web', 'web-0000cccc'), value, ask })
  } finally {
    await started.close('test')
  }
}

const remember = (value: <T>(path: string, body: object) => Promise<T>, project: ProjectRef, input: object): Promise<Memory> =>
  value<RememberWritten>('/memory/remember', { project, input: { distinct: true, ...input } }).then(written => written.memory)

const ids = (ranking: Ranking): string[] => ranking.candidates.map(item => item.memory.id)

describe('the project stores above and below a session', () => {
  test('a session below a project is reminded of that project memory by a name; a sibling folder memory stays out', () =>
    withNested(async ({ app, ios, web, value }) => {
      const parent = await remember(value, app, { text: 'RETRY_LIMIT is 5 for every client of the app' })
      const sibling = await remember(value, web, { text: 'RETRY_LIMIT is 9 on the web site' })
      const ranking = await value<Ranking>('/remind/prompt', { project: ios, query: 'what is RETRY_LIMIT here', limit: 10, blockCount: 10 })
      assert.ok(ids(ranking).includes(parent.id), 'the memory of the project above the session comes')
      assert.ok(!ids(ranking).includes(sibling.id), 'the memory of a sibling folder does not')
    }))

  test('a file tool in the project above finds a memory of the project below, its anchor named from the session root', () =>
    withNested(async ({ app, ios, value }) => {
      const child = await remember(value, ios, { text: 'The App struct holds the root scene of the iOS client', anchors: [{ type: 'file', path: 'Sources/App.swift' }] })
      const ranking = await value<Ranking>('/remind/tools', { project: app, paths: [join(ios.root, 'Sources', 'App.swift')], query: 'client ios Sources App swift', limit: 8 })
      const found = ranking.candidates.find(item => item.memory.id === child.id)
      assert.ok(found, 'the child store memory anchored at the file comes')
      assert.deepEqual(found.memory.anchors, [{ type: 'file', path: 'client-ios/Sources/App.swift' }])
    }))

  test('a session reaches a memory of the project above it by id: get, update and the search tool', () =>
    withNested(async ({ app, ios, value }) => {
      const parent = await remember(value, app, { text: 'The app ships a weekly build every Friday morning' })
      assert.equal((await value<Memory>('/memory/get', { project: ios, id: parent.id })).id, parent.id)
      await value('/memory/update', { project: ios, id: parent.id, patch: { text: 'The app ships a weekly build every Thursday morning' } })
      assert.equal((await value<Memory>('/memory/get', { project: app, id: parent.id })).text, 'The app ships a weekly build every Thursday morning', 'the update lands in the store that holds it')
      const hits = await value<Memory[]>('/memory/search', { project: ios, query: 'weekly build Thursday' })
      assert.deepEqual(hits.map(hit => hit.id), [parent.id])
      assert.equal((await value<{ counted: number }>('/memory/reminded', { project: ios, ids: [parent.id], trigger: 'prompt', sessionId: 's' })).counted, 1)
    }))

  test('the same text in the store above and in the session store is reminded once', () =>
    withNested(async ({ app, ios, value }) => {
      const text = 'RETRY_LIMIT must not change without the release owner'
      await remember(value, app, { text })
      await remember(value, ios, { text })
      const ranking = await value<Ranking>('/remind/prompt', { project: ios, query: 'can I change RETRY_LIMIT', limit: 10, blockCount: 10 })
      assert.equal(ranking.candidates.filter(item => item.memory.text === text).length, 1)
    }))

  test('a sibling folder memory is not reached by id', () =>
    withNested(async ({ ios, web, value, ask }) => {
      const sibling = await remember(value, web, { text: 'The web site deploys from the main branch' })
      assert.equal((await ask('/memory/get', { project: ios, id: sibling.id })).status, 404)
      const hits = await value<SearchHit[] | Memory[]>('/memory/search', { project: ios, query: 'web site deploys main branch' })
      assert.deepEqual(hits, [])
    }))
})

describe('which stores are above or below', () => {
  const ref = (key: string, root: string): ProjectRef => ({ key, name: key, root, commonDir: root })
  const home = '/home/kim'
  const session = ref('app-1', '/home/kim/work/app')

  test('a store above or below the root is read, one beside it or with a root that only starts alike is not', () => {
    const refs = [ref('work-1', '/home/kim/work'), ref('ios-1', '/home/kim/work/app/client-ios'), ref('web-1', '/home/kim/work/web'), ref('apple-1', '/home/kim/work/apple'), ref('app-2', '/home/kim/work/app-old'), session]
    assert.deepEqual(nestedRefs(session, refs, home).map(r => r.key), ['work-1', 'ios-1'])
  })

  test('the home directory and the folders above it are no project, in either direction', () => {
    const refs = [ref('home-1', '/home/kim'), ref('root-1', '/'), ref('ios-1', '/home/kim/work/app/client-ios')]
    assert.deepEqual(nestedRefs(session, refs, home).map(r => r.key), ['ios-1'], 'a store at the home directory reaches no project')
    assert.deepEqual(nestedRefs(ref('home-1', '/home/kim'), refs, home), [], 'a session at the home directory reads no other store')
  })

  test('a path is named from the session root inside it and stays absolute outside it', () => {
    assert.equal(rebase('Sources/App.swift', '/w/app/client-ios', '/w/app'), 'client-ios/Sources/App.swift')
    assert.equal(rebase('client-ios/Sources/App.swift', '/w/app', '/w/app/client-ios'), 'Sources/App.swift')
    assert.equal(rebase('web/index.ts', '/w/app', '/w/app/client-ios'), '/w/app/web/index.ts')
  })

  test('/tmp and its real path are one folder', () => {
    assert.equal(canonical('/tmp/'), canonical('/private/tmp'))
  })
})
