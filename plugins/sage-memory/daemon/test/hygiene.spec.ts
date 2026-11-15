import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { HygieneOptions, Memory, RememberInput } from '../../hooks/shared/model.ts'
import { reject } from '../candidates.ts'
import { markReminded, nextEpoch, recordedSessions } from '../contexts.ts'
import { createEmbeddings } from '../embeddings.ts'
import { checkedOptions, runHygiene, type HygieneJob } from '../hygiene.ts'
import type { Op } from '../op.ts'
import { deleteMemory } from '../remove.ts'
import { readAudit, readMemory, selectCandidates, sql, writeMemory } from '../rows.ts'
import { transaction, type Store } from '../stores.ts'
import { updateMemory } from '../update.ts'
import { textHash, writeVector } from '../vectors.ts'
import { fakeRuntime } from './fake-runtime.ts'
import { cleanUp, tempDir } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const DAY_MS = 86_400_000

/** An operation `days` after the world's clock. */
function later(w: World, days: number, store?: Store): Op {
  const op = w.op(store)
  return { ...op, now: new Date(Date.parse(op.now) + days * DAY_MS).toISOString() }
}

function job(w: World, fields: Partial<HygieneJob> = {}): HygieneJob {
  return {
    op: w.op(),
    scope: { root: w.root, agentDirs: [] },
    embeddings: createEmbeddings(fakeRuntime(false)),
    options: {},
    automatic: false,
    stopping: () => false,
    ...fields,
  }
}

/** Hygiene of the project store `days` after the world's clock, with the options given. */
function hygieneAt(w: World, days: number, options: HygieneOptions = {}, fields: Partial<HygieneJob> = {}): ReturnType<typeof runHygiene> {
  return runHygiene(job(w, { op: later(w, days), options, ...fields }))
}

async function remembered(w: World, input: RememberInput): Promise<Memory> {
  return (await w.remember(input)).memory
}

/** Writes fields a test needs past the rules that set them, such as counters. */
async function patched(w: World, id: string, fields: Partial<Memory>): Promise<void> {
  await w.run(op => writeMemory(op.store.db, { ...w.read(id), ...fields }))
}

/** A memory first written with its own placeholder text, then given `text`, so no write-time merge joins it to another. */
async function rewritten(w: World, placeholder: string, text: string, importance: number): Promise<Memory> {
  const { id } = await remembered(w, { text: placeholder })
  await w.run(op => updateMemory(op, { id, patch: { text, importance } }))
  return w.read(id)
}

/**
 * The pending reviews as [target, reason, action], ordered by target id. Ids written in one
 * millisecond do not sort by creation, so the order is the ids', compared on both sides.
 */
function pendingReviews(w: World): string[][] {
  const candidates = selectCandidates(w.project.db, "SELECT id, data FROM candidates WHERE status = 'pending'")
  return byTarget(candidates.map(candidate => [candidate.targetMemoryId ?? '', candidate.reviewReason ?? '', candidate.suggestedAction ?? '']))
}

function byTarget(rows: string[][]): string[][] {
  return [...rows].sort((left, right) => ((left[0] ?? '') < (right[0] ?? '') ? -1 : 1))
}

describe('hygiene verification', () => {
  test('the existence depth stales a memory whose file is gone and brings back one verification made stale', async () => {
    const w = world()
    await remembered(w, { text: 'The app entry registers the router before the first request', anchors: [{ type: 'file', path: 'src/app.ts' }] })
    await remembered(w, { text: 'The old worker drains the job queue on shutdown', anchors: [{ type: 'file', path: 'src/gone.ts' }] })
    const back = join(w.root, 'src', 'back.ts')
    writeFileSync(back, 'export {}\n')
    const restored = await remembered(w, { text: 'The back module re-exports the public types', anchors: [{ type: 'file', path: 'src/back.ts' }] })
    rmSync(back)
    const first = await hygieneAt(w, 0)
    assert.deepEqual([first.depth, first.checked, first.verified, first.staled, first.reactivated], ['existence', 3, 1, 2, 0])
    writeFileSync(back, 'export {}\n')
    const second = await hygieneAt(w, 0)
    assert.deepEqual([second.checked, second.verified, second.staled, second.reactivated], [3, 1, 0, 1], 'a memory whose file is still gone stays stale')
    assert.equal(w.read(restored.id).status, 'active')
    w.close()
  })

  test('the existence depth leaves a symbol alone, the content depth reads it, and verify off checks nothing', async () => {
    const w = world()
    const memory = await remembered(w, { text: 'The start function boots the app', anchors: [{ type: 'symbol', path: 'src/app.ts', symbol: 'start' }] })
    assert.equal((await hygieneAt(w, 0, { verify: false })).depth, 'off')
    assert.equal((await hygieneAt(w, 0)).staled, 0)
    assert.equal((await hygieneAt(w, 0, { verifyDepth: 'content' })).staled, 1)
    assert.equal(w.read(memory.id).staleReason, 'verification')
    w.close()
  })
})

describe('hygiene merges', () => {
  const SAME = 'Release notes are written in the pull request description'

  test('the same text in one scope and audience becomes one memory, the permanent one surviving with every list', async () => {
    const w = world()
    const kept = await remembered(w, { text: 'A placeholder about the release checklist', tags: ['release'] })
    const dup = await remembered(w, { text: 'Another placeholder about the deploy steps', tags: ['deploy'], importance: 0.9 })
    await w.run(op => updateMemory(op, { id: kept.id, patch: { text: SAME, persistence: 'permanent' } }))
    await w.run(op => updateMemory(op, { id: dup.id, patch: { text: `${SAME.toUpperCase()}.` } }))
    const own = await remembered(w, { text: SAME, scope: 'session', ownerSessionId: 's1' })
    const other = await remembered(w, { text: SAME, scope: 'session', ownerSessionId: 's2' })
    const report = await hygieneAt(w, 0)
    assert.equal(report.merged, 1)
    const survivor = w.read(kept.id)
    assert.deepEqual([survivor.status, survivor.tags, survivor.supersedes], ['active', ['release', 'deploy'], [dup.id]])
    assert.deepEqual([w.read(dup.id).status, w.read(dup.id).supersededBy], ['superseded', kept.id])
    assert.ok(w.edges().includes(`mem:${kept.id} supersedes mem:${dup.id}`))
    assert.deepEqual([w.read(own.id).status, w.read(other.id).status], ['active', 'active'], "one session's memory never merges with another's")
    w.close()
  })

  test('memories close only by words are never merged, so the opposite preference in the same words survives', async () => {
    const w = world()
    const tabs = await rewritten(w, 'A placeholder about the office plants', 'Prefer tabs over spaces for indentation in every file of this repository', 0.9)
    const spaces = await rewritten(w, 'Another placeholder about the lunch menu', 'Prefer spaces over tabs for indentation in every file of this repository', 0.5)
    const report = await hygieneAt(w, 0, { verify: false })
    assert.equal(report.merged, 0)
    assert.deepEqual([w.read(tabs.id).status, w.read(spaces.id).status], ['active', 'active'])
    assert.deepEqual([w.read(tabs.id).text, w.read(spaces.id).text], [tabs.text, spaces.text])
    w.close()
  })
})

describe('hygiene reviews', () => {
  test('a pair that cannot both hold is flagged on the newer memory with one review, and a second run flags nothing', async () => {
    const w = world()
    const older = await remembered(w, { text: 'The deploy job runs the migrations before the web servers start' })
    // A write close to a stored memory is held back, so the writer states it is another fact.
    const newer = await remembered(w, { text: 'The deploy job does not run the migrations before the web servers start', distinct: true })
    const first = await hygieneAt(w, 0)
    assert.deepEqual([first.contradictions, first.reviewsOpened], [1, 1])
    assert.deepEqual(w.read(newer.id).contradicts, [older.id])
    assert.deepEqual([w.read(newer.id).status, w.read(older.id).status], ['active', 'active'], 'a person decides which one holds')
    assert.deepEqual(pendingReviews(w), [[newer.id, `Possible contradiction with memory ${older.id}`, 'investigate']])
    assert.ok(w.edges().includes(`mem:${newer.id} contradicts mem:${older.id}`))
    const second = await hygieneAt(w, 0)
    assert.deepEqual([second.contradictions, second.reviewsOpened], [0, 0])
    w.close()
  })

  test('a stale memory and a doubtful one get a review each; reminders without a counted use open none', async () => {
    const w = world()
    const reminded = await remembered(w, { text: 'The cache layer keeps sessions for an hour' })
    await patched(w, reminded.id, { reminderCount: 10 })
    const stale = await remembered(w, { text: 'The legacy importer reads CSV files from the inbox folder' })
    await w.run(op => updateMemory(op, { id: stale.id, patch: { status: 'stale' } }))
    const doubtful = await remembered(w, { text: 'The search index may rebuild itself every night', confidence: 0.4 })
    const report = await hygieneAt(w, 91)
    assert.equal(report.reviewsOpened, 2)
    assert.deepEqual(
      pendingReviews(w),
      byTarget([
        [stale.id, 'freshness_low', 'investigate'],
        [doubtful.id, 'confidence_low', 'investigate'],
      ]),
    )
    w.close()
  })

  test('a memory a person reviewed is not asked about again while it says the same thing', async () => {
    const w = world()
    const memory = await remembered(w, { text: 'The cache layer may keep sessions for an hour', confidence: 0.4 })
    assert.equal((await hygieneAt(w, 31)).reviewsOpened, 1)
    const [review] = selectCandidates(w.project.db, "SELECT id, data FROM candidates WHERE status = 'pending'")
    await w.run(op => reject(op, { id: review?.id ?? '', reason: 'still true' }))
    assert.equal((await hygieneAt(w, 32)).reviewsOpened, 0)
    await w.run(op => updateMemory(op, { id: memory.id, patch: { text: 'The cache layer keeps sessions for two hours' } }))
    assert.equal((await hygieneAt(w, 70)).reviewsOpened, 1, 'the memory says something else now')
    w.close()
  })
})

describe('hygiene deletions', () => {
  test('session GC deletes an expired session memory and one a week untouched, and keeps a younger one', async () => {
    const w = world()
    const expired = await remembered(w, { text: 'The flaky login test failed twice today', scope: 'session', ownerSessionId: 's1', expiresAt: '2026-09-02T00:00:00.000Z' })
    const untouched = await remembered(w, { text: 'The websocket test waits for the mock server', scope: 'session', ownerSessionId: 's2' })
    const younger = await remembered(w, { text: 'The retry helper is under review in this session', scope: 'session', ownerSessionId: 's3' })
    await transaction(w.project, () => updateMemory(later(w, 5), { id: younger.id, patch: { importance: 0.7 } }))
    const report = await hygieneAt(w, 8)
    assert.equal(report.sessionDeleted, 2)
    assert.deepEqual(
      [expired, untouched, younger].map(memory => [w.read(memory.id).status, w.read(memory.id).contextPolicy]),
      [
        ['deleted', 'never'],
        ['deleted', 'never'],
        ['active', 'auto'],
      ],
    )
    const reasons = readAudit(w.project.db, 50).filter(entry => entry.action === 'memory.session_gc').map(entry => (entry.detail as { reason: string }).reason)
    assert.deepEqual(reasons.sort(), ['expires_at_passed', 'session_retention'])
    w.close()
  })

  test('the reminder records of a session whose transcript is gone are dropped, and an unreadable directory keeps them all', async () => {
    const w = world()
    const transcripts = join(tempDir(), 'projects')
    mkdirSync(join(transcripts, '-repo'), { recursive: true })
    writeFileSync(join(transcripts, '-repo', 'kept-session.jsonl'), '{}\n')
    const memory = await remembered(w, { text: 'The app entry registers the router before the first request' })
    await w.run(op => markReminded(op, { sessionId: 'kept-session', loop: 'main', ids: [memory.id], trigger: 'tool_batch' }))
    await w.run(op => markReminded(op, { sessionId: 'gone-session', loop: 'agent-1', ids: [memory.id], trigger: 'tool_batch' }))
    await w.run(op => nextEpoch(op, 'gone-session', 'main'))
    const unreadable = await hygieneAt(w, 0, {}, { transcripts: join(tempDir(), 'nowhere') })
    assert.equal(unreadable.sessionsForgotten, 0)
    assert.match(unreadable.notes[0] ?? '', /^the reminder records stay: the transcripts could not be read: ENOENT/)
    const report = await hygieneAt(w, 0, {}, { transcripts })
    assert.equal(report.sessionsForgotten, 1)
    assert.deepEqual(recordedSessions(w.project.db), ['kept-session'])
    w.close()
  })

  test('the purge removes tombstones deleted the given days ago with their vectors, and keeps a permanent one', async () => {
    const w = world()
    const plain = await remembered(w, { text: 'The old worker drains the job queue on shutdown' })
    const kept = await remembered(w, { text: 'The billing service owns the invoice tables', persistence: 'permanent' })
    await w.run(op => writeVector(op.store.db, plain.id, 'fake/model', new Float32Array(16), textHash(plain.text)))
    for (const memory of [plain, kept]) await w.run(op => deleteMemory(op, { id: memory.id, reason: 'test', force: true }))
    assert.equal((await hygieneAt(w, 3, { purgeDeletedAfterDays: 5 })).purged, 0, 'deleted three days ago')
    assert.equal((await hygieneAt(w, 10, { purgeDeletedAfterDays: 5 })).purged, 1)
    assert.equal(readMemory(w.project.db, plain.id), undefined)
    assert.equal(sql(w.project.db, 'SELECT COUNT(*) AS n FROM vectors').get()?.n, 0)
    assert.equal(w.read(kept.id).status, 'deleted')
    w.close()
  })
})

describe('hygiene runs', () => {
  test('a run stops between its steps once the daemon closes, and records itself as stopped', async () => {
    const w = world()
    const report = await runHygiene(job(w, { stopping: () => true }))
    assert.equal(report.stopped, true)
    assert.deepEqual(
      readAudit(w.project.db, 1).map(entry => entry.action),
      ['memory.hygiene_stopped'],
    )
    w.close()
  })

  test('each option is checked, and one it does not know is refused', () => {
    assert.deepEqual(checkedOptions({ verifyDepth: 'git', staleReviewDays: 30 }), { verifyDepth: 'git', staleReviewDays: 30 })
    assert.throws(() => checkedOptions({ retentionDays: 90 }), /^Error: options take no retentionDays$/)
    assert.throws(() => checkedOptions({ unusedMinReminders: 3 }), /^Error: options take no unusedMinReminders$/)
    assert.throws(() => checkedOptions({ verifyDepth: 'deep' }), /options\.verifyDepth must be one of: existence, content, git/)
    assert.throws(() => checkedOptions({ purgeDeletedAfterDays: 0 }), /options\.purgeDeletedAfterDays must be a number of days above 0/)
    assert.throws(() => checkedOptions({ verify: 'no' }), /options\.verify must be true or false/)
    assert.throws(() => checkedOptions({ nearDedup: false }), /^Error: options take no nearDedup$/, 'hygiene merges no near pair, so the option is gone')
  })
})
