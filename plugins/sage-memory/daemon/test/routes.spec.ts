import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { layoutOf } from '../../hooks/shared/layout.ts'
import type { AuditEntry, BackfillReport, Candidate, Memory, MemoryPage, Ranking, RememberResult, Resolution, SearchHit, StoreStats, UpdateResult, VerifyReport } from '../../hooks/shared/model.ts'
import type { EmbedStatus, ProjectRef, SetupJob, Status } from '../../hooks/shared/protocol.ts'
import type { Runtime } from '../embedder.ts'
import { call } from '../http.ts'
import { startServer } from '../server.ts'
import { fakeRuntime, toward } from './fake-runtime.ts'
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

/** A daemon for `work`; without a runtime it reads the real one from its own empty directory, so embeddings are off. */
async function withDaemon(work: (daemon: Daemon) => Promise<void>, runtime?: Runtime): Promise<void> {
  const base = tempDir()
  const dir = join(base, 'data')
  const started = await startServer({ dir, version: '9.9.9', idleMs: 60_000, runtime })
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

describe('read and reminder routes', () => {
  test('a search reads both stores rank by rank, and the explained search scores each hit by its place', () =>
    withDaemon(async d => {
      const project = await d.remember(d.alpha, { text: 'Use pnpm workspaces for the monorepo packages' })
      const user = await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      assert.deepEqual((await d.value<Memory[]>('/memory/search', { project: d.alpha, query: 'pnpm' })).map(m => m.id), [project.id, user.id])
      const explained = await d.value<SearchHit[]>('/memory/explain', { project: d.beta, query: 'pnpm' })
      assert.deepEqual(explained.map(hit => [hit.memory.id, hit.lexicalScore, hit.source]), [[user.id, 1, 'lexical']], 'another project finds the user memory alone')
    }))

  test('what a context was reminded of is held back until the context starts over', () =>
    withDaemon(async d => {
      mkdirSync(join(d.alpha.root, 'src'), { recursive: true })
      const memory = await d.remember(d.alpha, { text: 'The app entry must register the router first', anchors: [{ type: 'file', path: 'src/app.ts' }] })
      const ask = { project: d.alpha, sessionId: 's1', loop: 'main', paths: [join(d.alpha.root, 'src/app.ts')], query: 'src/app.ts app.ts app', limit: 8 }
      assert.deepEqual((await d.value<Ranking>('/remind/tools', ask)).candidates.map(c => c.memory.id), [memory.id])
      assert.deepEqual(await d.value('/memory/reminded', { project: d.alpha, ids: [memory.id], trigger: 'tool_batch', sessionId: 's1', loop: 'main' }), { counted: 1 })
      assert.deepEqual((await d.value<Ranking>('/remind/tools', ask)).rejected.map(r => r.gate), ['reminded'])
      assert.deepEqual(await d.value('/context/new', { project: d.alpha, sessionId: 's1', loop: 'main' }), { epoch: 1 })
      assert.equal((await d.value<Ranking>('/remind/tools', ask)).candidates.length, 1)
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: memory.id })).reminderCount, 1)
    }))

  test('a listing pages with its cursor and refuses one it did not write; a file outside the project is refused', () =>
    withDaemon(async d => {
      for (const text of ['The build pipeline caches pnpm stores', 'Releases are tagged from main on Tuesday', PREFERENCE]) await d.remember(d.alpha, { text })
      const first = await d.value<MemoryPage>('/memory/list', { project: d.alpha, limit: 2 })
      assert.deepEqual([first.memories.length, first.total], [2, 3])
      const second = await d.value<MemoryPage>('/memory/list', { project: d.alpha, limit: 2, cursor: first.nextCursor })
      assert.deepEqual([second.memories.length, second.nextCursor], [1, null])
      const bad = await d.ask('/memory/list', { project: d.alpha, cursor: 'nope' })
      assert.deepEqual([bad.status, bad.error], [400, 'the cursor is not one a listing wrote'])
      const outside = await d.ask('/memory/for-file', { project: d.alpha, path: '/etc/hosts' })
      assert.deepEqual([outside.status, outside.error], [400, 'the path is outside the project root'])
      const stats = await d.value<{ project: StoreStats; user: StoreStats }>('/memory/stats', { project: d.alpha })
      assert.deepEqual([stats.project.total, stats.user.total], [3, 0])
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

describe('upkeep routes', () => {
  const ENTRY = 'The app entry registers the router before the first request'

  function sourceFile(project: ProjectRef, name: string): string {
    mkdirSync(join(project.root, 'src'), { recursive: true })
    const path = join(project.root, 'src', name)
    writeFileSync(path, 'export {}\n')
    return path
  }

  test('verify checks one memory by its id, or every anchored memory of both stores, and refuses a deleted one', () =>
    withDaemon(async d => {
      sourceFile(d.alpha, 'app.ts')
      const kept = await d.remember(d.alpha, { text: ENTRY, anchors: [{ type: 'file', path: 'src/app.ts' }] })
      const gone = await d.remember(d.alpha, { text: 'The old worker drains the job queue on shutdown', anchors: [{ type: 'file', path: 'src/worker.ts' }] })
      const user = await d.remember(d.alpha, { text: 'Format shell scripts with the shfmt formatter', scope: 'user', anchors: [{ type: 'command', command: 'missing-tool-xyz -w' }] })
      await d.remember(d.alpha, { text: MIGRATIONS })
      const all = await d.value<VerifyReport>('/memory/verify', { project: d.alpha })
      assert.deepEqual(
        all.results.map(result => [result.memoryId, result.status]),
        [
          [kept.id, 'verified'],
          [gone.id, 'stale'],
          [user.id, 'stale'],
        ],
        'a memory with no anchor has nothing to check',
      )
      assert.deepEqual([all.staled, all.reactivated], [[gone.id, user.id], []])
      assert.equal((await d.value<Memory>('/memory/get', { project: d.beta, id: user.id })).status, 'stale')
      const one = await d.value<VerifyReport>('/memory/verify', { project: d.alpha, id: kept.id })
      assert.deepEqual(one.results.map(result => result.memoryId), [kept.id])
      await d.value('/memory/delete', { project: d.alpha, id: kept.id, force: true })
      const deleted = await d.ask('/memory/verify', { project: d.alpha, id: kept.id })
      assert.deepEqual([deleted.status, deleted.error], [409, `${kept.id} is deleted; recover it before verifying it`])
    }))

  test('verify-paths checks the memories anchored to the changed files alone', () =>
    withDaemon(async d => {
      const app = sourceFile(d.alpha, 'app.ts')
      sourceFile(d.alpha, 'other.ts')
      const changed = await d.remember(d.alpha, { text: ENTRY, anchors: [{ type: 'symbol', path: 'src/app.ts', symbol: 'main' }] })
      const other = await d.remember(d.alpha, { text: 'The other module exports nothing yet', anchors: [{ type: 'file', path: 'src/other.ts' }] })
      const report = await d.value<VerifyReport>('/memory/verify-paths', { project: d.alpha, paths: [app] })
      assert.deepEqual([report.results.map(result => result.memoryId), report.staled], [[changed.id], [changed.id]], 'main is not in the file')
      assert.equal((await d.value<Memory>('/memory/get', { project: d.alpha, id: other.id })).lastVerifiedAt, undefined)
      rmSync(app)
      writeFileSync(app, 'export function main() {}\n')
      assert.deepEqual((await d.value<VerifyReport>('/memory/verify-paths', { project: d.alpha, paths: ['src/app.ts'] })).reactivated, [changed.id])
    }))
})

/** Polls `/embed/status` as the hooks module does, until the setup job ends. */
async function setupEnded(d: Daemon): Promise<EmbedStatus> {
  const deadline = Date.now() + 5000
  for (;;) {
    const status = await d.value<EmbedStatus>('/embed/status', {})
    if (status.setup.state !== 'running') return status
    if (Date.now() >= deadline) throw new Error('the setup job did not end in 5000 ms')
    await sleep(20)
  }
}

describe('embedding routes', () => {
  test('without the runtime embeddings are off, and a search answers from the text index alone', () =>
    withDaemon(async d => {
      assert.deepEqual(await d.value<EmbedStatus>('/embed/status', {}), { embedding: { state: 'off' }, setup: { state: 'idle' } })
      assert.deepEqual((await d.value<Status>('/status', {})).embedding, { state: 'off' })
      await d.remember(d.alpha, { text: MIGRATIONS })
      assert.deepEqual((await d.value<SearchHit[]>('/memory/explain', { project: d.alpha, query: 'migrations' })).map(hit => hit.source), ['lexical'])
    }))

  test('a remembered memory is embedded at once, and a question with no word in common finds it', () => {
    const fake = fakeRuntime()
    const question = 'veritabanı şemasını ne zaman güncellerim'
    fake.vectors.set(MIGRATIONS, toward(0, 1))
    fake.vectors.set(question, toward(0, 0.62))
    return withDaemon(async d => {
      const memory = await d.remember(d.alpha, { text: MIGRATIONS })
      const hits = await d.value<SearchHit[]>('/memory/explain', { project: d.alpha, query: question })
      assert.deepEqual(hits.map(hit => [hit.memory.id, hit.source, hit.vectorScore?.toFixed(2)]), [[memory.id, 'vector', '0.62']])
      assert.deepEqual((await d.value<EmbedStatus>('/embed/status', {})).embedding, { state: 'ready', modelId: 'fake/model', dims: 16 })
    }, fake)
  })

  test('setup runs as a job the status route reports, and embeds what was written before it', () => {
    const fake = fakeRuntime(false)
    return withDaemon(async d => {
      await d.remember(d.alpha, { text: MIGRATIONS })
      await d.remember(d.alpha, { text: PREFERENCE, scope: 'user' })
      const started = await d.value<SetupJob>('/embed/setup', {})
      assert.equal(started.state, 'running')
      const status = await setupEnded(d)
      assert.deepEqual([status.setup.state, status.setup.state === 'done' && status.setup.indexed], ['done', 2])
      assert.deepEqual(status.embedding, { state: 'ready', modelId: 'fake/model', dims: 16 })
    }, fake)
  })
})
