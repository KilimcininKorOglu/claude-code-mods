import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { layoutOf } from '../../hooks/shared/layout.ts'
import type { AuditEntry, BackfillReport, Candidate, Memory, RememberResult, Resolution, UpdateResult } from '../../hooks/shared/model.ts'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { call } from '../http.ts'
import { startServer } from '../server.ts'
import { cleanUp, tempDir } from './support.ts'

after(cleanUp)

const MIGRATIONS = 'Run the database migrations with pnpm before starting the dev server'
const PREFERENCE = 'Prefer pnpm over npm in every project'

type Reply = { status: number; value: unknown; error: string | undefined }

/** A daemon on a directory of its own, and two projects whose requests it serves. */
type Daemon = {
  dir: string
  alpha: ProjectRef
  beta: ProjectRef
  ask: (path: string, body: object) => Promise<Reply>
  /** The value of an answer that must be 200; any other status fails with the error it carried. */
  value: <T>(path: string, body: object) => Promise<T>
  /** Remembers a text in a project, the user scope when `scope` says so. */
  remember: (project: ProjectRef, input: object) => Promise<Memory>
}

function projectIn(base: string, name: string): ProjectRef {
  const root = join(base, name)
  mkdirSync(root, { recursive: true })
  return { key: `${name}-0000aaaa`, name, root, commonDir: join(root, '.git') }
}

async function withDaemon(work: (daemon: Daemon) => Promise<void>): Promise<void> {
  const base = tempDir()
  const dir = join(base, 'data')
  const started = await startServer({ dir, version: '9.9.9', idleMs: 60_000 })
  if (!started.owned) throw new Error(`the daemon of pid ${started.hello.pid} kept the socket`)
  const ask = async (path: string, body: object): Promise<Reply> => {
    const answer = await call(layoutOf(dir).socket, path, { method: 'POST', token: started.token, body: JSON.stringify(body), timeoutMs: 5000 })
    const reply = answer.reply as { value?: unknown; error?: string }
    return { status: answer.status, value: reply.value, error: reply.error }
  }
  const value = async <T>(path: string, body: object): Promise<T> => {
    const reply = await ask(path, body)
    assert.equal(reply.status, 200, `${path}: ${reply.error ?? ''}`)
    return reply.value as T
  }
  const remember = async (project: ProjectRef, input: object): Promise<Memory> => (await value<RememberResult>('/memory/remember', { project, input })).memory
  try {
    await work({ dir, alpha: projectIn(base, 'alpha'), beta: projectIn(base, 'beta'), ask, value, remember })
  } finally {
    await started.close('test')
  }
}

describe('where a memory is kept', () => {
  test('a user memory is kept in the global store, and a project memory in its own project store', () =>
    withDaemon(async d => {
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      const own = await d.remember(d.alpha, { text: MIGRATIONS })
      assert.equal((await d.value<Memory>('/memory/get', { project: d.beta, id: user.id })).scope, 'user', 'every project reads the user store')
      const hidden = await d.ask('/memory/get', { project: d.beta, id: own.id })
      assert.deepEqual([hidden.status, hidden.error], [404, `no memory ${own.id} in the project or the user store`])
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: own.id })).text, MIGRATIONS)
      assert.ok(existsSync(layoutOf(d.dir).globalDb))
      const recorded = JSON.parse(readFileSync(join(d.dir, d.alpha.key, 'project.json'), 'utf8')) as ProjectRef
      assert.deepEqual([recorded.name, recorded.root], ['alpha', d.alpha.root])
    }))

  test('forget reaches the store of the scope it names, and clear without a scope the project store alone', () =>
    withDaemon(async d => {
      const project = await d.remember(d.alpha, { text: 'Deploy previews run pnpm build with the staging environment' })
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      const forgotten = await d.value<{ removed: string[] }>('/memory/forget', { project: d.alpha, query: 'pnpm', scope: 'user', force: true })
      assert.deepEqual(forgotten.removed, [user.id])
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: project.id })).status, 'active')
      const kept = await d.remember(d.alpha, { text: 'Prefer tabs over spaces in every project', scope: 'user' })
      assert.equal((await d.value<{ cleared: number }>('/memory/clear', { project: d.alpha, force: true })).cleared, 1)
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: project.id })).status, 'deleted')
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: kept.id })).status, 'active', 'the user store is shared by every project')
    }))

  test('reminders and uses count in whichever store holds each id, and an unknown id is skipped', () =>
    withDaemon(async d => {
      const project = await d.remember(d.alpha, { text: MIGRATIONS })
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      const ids = [project.id, user.id, 'NOPE']
      assert.deepEqual(await d.value('/memory/reminded', { project: d.alpha, ids, trigger: 'tool_batch', sessionId: 's1' }), { counted: 2 })
      assert.deepEqual(await d.value('/memory/used', { project: d.beta, ids, source: 'answer', sessionId: 's1' }), { counted: 1 }, 'another project reaches the user memory alone')
      const counts = async (id: string): Promise<unknown[]> => {
        const memory = await d.value<Memory>('/memory/get', { project: d.alpha, id })
        return [memory.reminderCount, memory.useCount]
      }
      assert.deepEqual(await counts(project.id), [1, undefined])
      assert.deepEqual(await counts(user.id), [1, 1])
    }))

  test('the audit log merges both stores, newest first', () =>
    withDaemon(async d => {
      const project = await d.remember(d.alpha, { text: MIGRATIONS })
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      await d.value('/memory/delete', { project: d.alpha, id: user.id, force: true })
      await d.value('/memory/delete', { project: d.alpha, id: project.id, force: true })
      const entries = await d.value<AuditEntry[]>('/audit', { project: d.alpha, limit: 10 })
      assert.deepEqual(
        entries.map(entry => [entry.action, entry.memoryId]),
        [
          ['memory.deleted', project.id],
          ['memory.deleted', user.id],
        ],
      )
      assert.equal((await d.value<AuditEntry[]>('/audit', { project: d.alpha, limit: 1 })).length, 1)
    }))

  test('backfill reports each store on its own', () =>
    withDaemon(async d => {
      const project = await d.remember(d.alpha, { text: MIGRATIONS })
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      await d.value('/memory/delete', { project: d.alpha, id: project.id, force: true })
      await d.value('/memory/delete', { project: d.alpha, id: user.id, force: true })
      const dry = await d.value<{ project: BackfillReport; user: BackfillReport }>('/memory/backfill', { project: d.alpha })
      assert.deepEqual([dry.project.recoverable, dry.user.recoverable, dry.project.recovered + dry.user.recovered], [1, 1, 0])
      const applied = await d.value<{ project: BackfillReport; user: BackfillReport }>('/memory/backfill', { project: d.alpha, apply: true, filter: { scopes: ['user'] } })
      assert.deepEqual([applied.project.recovered, applied.user.recovered], [0, 1])
    }))
})

describe('what a request is refused for', () => {
  test('a field of the wrong shape is a 400 that names the field, and nothing is written', () =>
    withDaemon(async d => {
      const memory = await d.remember(d.alpha, { text: MIGRATIONS })
      const cases: Array<[path: string, body: object, error: RegExp]> = [
        ['/memory/get', { id: memory.id }, /^project must be an object$/],
        ['/memory/get', { project: { ...d.alpha, key: '../up' }, id: memory.id }, /^project\.key is not a project key: "\.\.\/up"$/],
        ['/memory/get', { project: { ...d.alpha, root: 'relative' }, id: memory.id }, /^project\.root must be an absolute path$/],
        ['/memory/get', { project: d.alpha }, /^id must be a non-empty string$/],
        ['/memory/remember', { project: d.alpha, input: MIGRATIONS }, /^input must be an object$/],
        ['/memory/forget', { project: d.alpha, query: 'pnpm', scope: 'team', force: true }, /^scope must be one of: project, user, session, file, symbol$/],
        ['/memory/delete', { project: d.alpha, id: memory.id, force: 'yes' }, /^force must be true or false$/],
        ['/memory/reminded', { project: d.alpha, ids: memory.id, trigger: 'tool_batch' }, /^ids must be an array of strings$/],
        ['/audit', { project: d.alpha, limit: 0 }, /^limit must be a whole number from 1 to 1000$/],
      ]
      for (const [path, body, error] of cases) {
        const reply = await d.ask(path, body)
        assert.equal(reply.status, 400, `${path} ${JSON.stringify(body)}`)
        assert.match(reply.error ?? '', error)
      }
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: memory.id })).status, 'active', 'the refused delete wrote nothing')
      assert.equal(existsSync(join(d.dir, '..', 'up')), false)
    }))

  test("another session's session memory is a 403, and its own session and the person may change it", () =>
    withDaemon(async d => {
      const memory = await d.remember(d.alpha, { text: 'The websocket reconnect test fails on the CI runner', scope: 'session', ownerSessionId: 's1' })
      const other = await d.ask('/memory/update', { project: d.alpha, id: memory.id, patch: { importance: 0.9 }, sessionId: 's2' })
      assert.deepEqual([other.status, other.error], [403, `${memory.id} is a session memory of another session, so this session cannot change it`])
      assert.equal((await d.value<UpdateResult>('/memory/update', { project: d.alpha, id: memory.id, patch: { importance: 0.9 }, sessionId: 's1' })).memory.importance, 0.9)
      assert.equal((await d.value<UpdateResult>('/memory/update', { project: d.alpha, id: memory.id, patch: { importance: 0.7 } })).memory.importance, 0.7)
    }))

  test('a delete needs force, and a deleted memory refuses a patch with 409 until it is recovered', () =>
    withDaemon(async d => {
      const memory = await d.remember(d.alpha, { text: MIGRATIONS })
      assert.equal((await d.ask('/memory/delete', { project: d.alpha, id: memory.id })).status, 400)
      assert.deepEqual(await d.value('/memory/delete', { project: d.alpha, id: memory.id, force: true }), { deleted: true })
      const patch = await d.ask('/memory/update', { project: d.alpha, id: memory.id, patch: { importance: 0.9 } })
      assert.deepEqual([patch.status, patch.error], [409, `${memory.id} is deleted; recover it before changing it`])
      const recovered = await d.value<{ memory: Memory; noop: boolean }>('/memory/recover', { project: d.alpha, id: memory.id })
      assert.deepEqual([recovered.memory.status, recovered.noop], ['active', false])
      assert.equal((await d.ask('/memory/update', { project: d.alpha, id: memory.id, patch: { importance: 0.9 } })).status, 200)
    }))
})

describe('candidate routes', () => {
  test('a review of a user memory is kept in the user store, and every project finds it by its id', () =>
    withDaemon(async d => {
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      const input = { text: 'Reminded ten times and never used in an answer', targetMemoryId: user.id, reviewReason: 'reminded_never_used', suggestedAction: 'archive' }
      const review = await d.value<Candidate>('/candidates/propose', { project: d.alpha, input })
      assert.deepEqual((await d.value<Candidate[]>('/candidates/list', { project: d.beta })).map(candidate => candidate.id), [review.id])
      const accepted = await d.value<{ resolution: Resolution }>('/candidates/accept', { project: d.beta, id: review.id })
      assert.equal(accepted.resolution.applied, true)
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: user.id })).status, 'archived')
      const missing = await d.ask('/candidates/reject', { project: d.alpha, id: 'candidate_NOPE' })
      assert.deepEqual([missing.status, missing.error], [404, 'no candidate candidate_NOPE in the project or the user store'])
    }))

  test('a proposal of the user scope is kept in the user store and accepted into a user memory', () =>
    withDaemon(async d => {
      const proposal = await d.value<Candidate>('/candidates/propose', { project: d.alpha, input: { text: PREFERENCE, scope: 'user' } })
      const accepted = await d.value<{ memory: Memory }>('/candidates/accept', { project: d.beta, id: proposal.id })
      assert.equal(accepted.memory.scope, 'user')
      assert.equal((await d.value<Memory>('/memory/get', { project: d.beta, id: accepted.memory.id })).text, PREFERENCE)
      assert.deepEqual(await d.value('/candidates/list', { project: d.alpha }), [], 'the accepted proposal is no longer pending')
    }))
})
