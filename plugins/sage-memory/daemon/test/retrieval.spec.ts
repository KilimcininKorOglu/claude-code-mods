import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { propose } from '../candidates.ts'
import { fileMatches, groupFileMatches } from '../for-file.ts'
import { listPage, storeStats, type ListOptions } from '../listing.ts'
import { findRelated, graphFor } from '../related.ts'
import { memoriesForAudience, memoriesForPaths } from '../retrieve.ts'
import { EVERY_POLICY, REMINDED_POLICY, searchStore, type Visibility } from '../search.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

const SHOWN: Visibility = { statuses: ['active'], policies: EVERY_POLICY, audienceScoped: true }

describe('search', () => {
  test('every term first, any term when that finds nothing, and a blank query lists the most important', async () => {
    const w = world()
    const pool = (await w.remember({ text: 'The connection pool keeps twenty sockets for each worker', importance: 0.7 })).memory
    const deploys = (await w.remember({ text: 'Deploys go through the staging branch before production', importance: 0.9 })).memory
    assert.deepEqual(searchStore(w.project.db, 'connection sockets', SHOWN, 10).map(m => m.id), [pool.id])
    assert.deepEqual(searchStore(w.project.db, 'sockets staging', SHOWN, 10).map(m => m.id).sort(), [pool.id, deploys.id].sort(), 'no memory holds both, so either term finds')
    assert.deepEqual(searchStore(w.project.db, '  ', SHOWN, 10).map(m => m.id), [deploys.id, pool.id])
    assert.deepEqual(searchStore(w.project.db, 'a ? b', SHOWN, 10), [], 'no searchable term finds nothing')
    w.close()
  })

  test("a reminder never carries a never or always memory, an audience's memory, or another session's", async () => {
    const w = world()
    await w.remember({ text: 'Pool sizing is private to the operators', contextPolicy: 'never' })
    await w.remember({ text: 'Pool sizing follows the core count of the host', contextPolicy: 'always' })
    await w.remember({ text: 'Pool sizing questions go to the explore agent', audience: { roles: ['explore'] } })
    const other = (await w.remember({ text: 'Pool sizing was measured in another session', scope: 'session', ownerSessionId: 's2' })).memory
    const plain = (await w.remember({ text: 'Pool sizing below eight starves the worker sockets' })).memory
    const reminded: Visibility = { statuses: ['active'], policies: REMINDED_POLICY, audienceScoped: false, sessionId: 's1' }
    assert.deepEqual(searchStore(w.project.db, 'pool sizing', reminded, 10).map(m => m.id), [plain.id])
    assert.equal(searchStore(w.project.db, 'pool sizing', SHOWN, 10).length, 4, 'an explicit read shows the policies and audiences, not another session')
    assert.ok(searchStore(w.project.db, 'pool sizing', { ...SHOWN, allSessions: true }, 10).some(m => m.id === other.id), 'the person reads every session')
    w.close()
  })
})

describe('memories for a path', () => {
  test('an anchor on the path, on a symbol in it, or on a directory above it', async () => {
    const w = world()
    const file = (await w.remember({ text: 'The app entry wires the router and the store', anchors: [{ type: 'file', path: 'src/app.ts' }] })).memory
    const symbol = (await w.remember({ text: 'main() must stay synchronous for the test harness', anchors: [{ type: 'symbol', path: 'src/app.ts', symbol: 'main' }] })).memory
    const directory = (await w.remember({ text: 'Everything under src is compiled with strict null checks', anchors: [{ type: 'directory', path: 'src' }] })).memory
    await w.remember({ text: 'The docs site builds from the markdown files alone', anchors: [{ type: 'directory', path: 'docs' }] })
    const found = memoriesForPaths(w.op(), ['src/app.ts'], { ...SHOWN, statuses: ['active', 'stale'] }, 10).map(m => m.id)
    assert.deepEqual(found.sort(), [file.id, symbol.id, directory.id].sort())
    assert.deepEqual(memoriesForPaths(w.op(), [], SHOWN, 10), [])
    w.close()
  })
})

describe('memories for an audience', () => {
  test('every field the audience fills must name the context, and a stale or never memory takes no place', async () => {
    const w = world()
    const explore = (await w.remember({ text: 'Explore agents read the ADR folder first', audience: { roles: ['Explore'] } })).memory
    const plan = (await w.remember({ text: 'Plan mode sessions list the migrations before changing them', audience: { modes: ['plan'] } })).memory
    const both = (await w.remember({ text: 'Explore agents in plan mode skip the generated clients', audience: { roles: ['explore'], modes: ['plan'] } })).memory
    const stale = (await w.remember({ text: 'Explore agents used to read the old wiki pages', audience: { roles: ['explore'] } })).memory
    await w.run(op => updateMemory(op, { id: stale.id, patch: { status: 'stale' } }))
    await w.remember({ text: 'Explore agents never see this note at all', audience: { roles: ['explore'] }, contextPolicy: 'never' })
    const ids = (role: string, mode?: string): string[] => memoriesForAudience(w.op(), { role, mode }, undefined, 20).map(m => m.id).sort()
    assert.deepEqual(ids('Explore'), [explore.id])
    assert.deepEqual(ids('explore', 'plan'), [explore.id, plan.id, both.id].sort())
    assert.deepEqual(ids('general-purpose', 'plan'), [plan.id])
    w.close()
  })
})

describe('the graph read back', () => {
  test('related memories come through the graph, a shared tag and a command family, never the seed itself', async () => {
    const w = world()
    const seed = (await w.remember({ text: 'Run pnpm test with the watch flag off in CI', tags: ['ci'], anchors: [{ type: 'command', command: 'pnpm test --run' }] })).memory
    const family = (await w.remember({ text: 'The test command needs the database container running first', anchors: [{ type: 'command', command: 'pnpm test' }] })).memory
    const tagged = (await w.remember({ text: 'CI caches the pnpm store between the jobs of one pipeline', tags: ['ci'] })).memory
    const newer = (await w.remember({ text: 'Run pnpm test in CI with the junit reporter enabled', supersedes: [seed.id] })).memory
    await w.remember({ text: 'The docs site builds from the markdown files alone' })
    const visibility: Visibility = { statuses: ['active', 'superseded'], policies: ['auto', 'always'], audienceScoped: true }
    const related = findRelated(w.op(), [seed.id], { visibility, limit: 10, maxDepth: 3 }).map(m => m.id)
    assert.deepEqual(related.sort(), [family.id, tagged.id, newer.id].sort())
    w.close()
  })

  test('the graph around a memory id or a path', async () => {
    const w = world()
    const { memory } = await w.remember({ text: 'main() must stay synchronous for the test harness', anchors: [{ type: 'symbol', path: 'src/app.ts', symbol: 'main' }] })
    const byId = graphFor(w.op(), memory.id, SHOWN, 2, 100).map(edge => `${edge.from} ${edge.relation} ${edge.to}`)
    assert.ok(byId.includes(`mem:${memory.id} about_symbol symbol:src/app.ts#main`))
    assert.ok(byId.includes('symbol:src/app.ts#main related_to file:src/app.ts'))
    const byPath = graphFor(w.op(), 'src/app.ts', SHOWN, 1, 100).map(edge => edge.from)
    assert.ok(byPath.includes(`mem:${memory.id}`))
    w.close()
  })
})

describe('memories for a file', () => {
  test('grouped by how they match, a symbol under the cursor first, with the successor and a pending review', async () => {
    const w = world()
    const file = (await w.remember({ text: 'The app entry wires the router and the store', anchors: [{ type: 'file', path: 'src/app.ts' }] })).memory
    const cursor = (await w.remember({ text: 'main() must stay synchronous for the test harness', anchors: [{ type: 'symbol', path: 'src/app.ts', symbol: 'main', lineStart: 1, lineEnd: 3 }] })).memory
    const elsewhere = (await w.remember({ text: 'render() batches its DOM writes into one frame', anchors: [{ type: 'symbol', path: 'src/app.ts', symbol: 'render', lineStart: 40, lineEnd: 60 }] })).memory
    const mention = (await w.remember({ text: 'Never import app.ts from a worker thread' })).memory
    const newer = (await w.remember({ text: 'Routing moved out of the entry into the file based router', anchors: [{ type: 'file', path: 'src/app.ts' }], supersedes: [file.id] })).memory
    const review = await w.run(op => propose(op, { text: 'Reminded often and never used', targetMemoryId: newer.id, suggestedAction: 'archive' }))
    const options = { lineStart: 2, lineEnd: 2, limit: 10, includeSuperseded: true, includeDeleted: false }
    const grouped = groupFileMatches('src/app.ts', fileMatches(w.op(), 'src/app.ts', options), 10)
    assert.deepEqual(grouped.symbolMatches.map(m => [m.memory.id, m.matchStrength]), [
      [cursor.id, 0.95],
      [elsewhere.id, 0.75],
    ])
    assert.deepEqual(grouped.relatedMatches.map(m => m.memory.id), [mention.id])
    const old = grouped.primaryMatches.find(m => m.memory.id === file.id)
    assert.equal(old?.supersededByActiveId, newer.id)
    assert.equal(grouped.primaryMatches.find(m => m.memory.id === newer.id)?.pendingReview?.candidateId, review.id)
    assert.deepEqual([grouped.totalCount, grouped.supersededCount, grouped.reviewPendingCount], [5, 1, 1])
    w.close()
  })
})

describe('listing', () => {
  const options = (fields: Partial<ListOptions> = {}): ListOptions => ({ statuses: ['active', 'stale'], limit: 2, ...fields })

  test('pages follow the cursor across both stores, newest change first', async () => {
    const w = world()
    const ids: string[] = []
    for (const text of ['The build pipeline caches pnpm stores', 'Releases are tagged from main on Tuesday', 'Integration tests need a Postgres container']) {
      ids.push((await w.remember({ text })).memory.id)
    }
    for (const text of ['Prefer tabs over spaces in every editor', 'Answer in the language of the question']) {
      ids.push((await w.remember({ text, scope: 'user' }, w.global)).memory.id)
    }
    const dbs = [w.project.db, w.global.db]
    const first = listPage(dbs, options())
    assert.deepEqual(first.memories.map(m => m.id), [ids[4], ids[3]])
    assert.equal(first.total, 5)
    const second = listPage(dbs, options({ cursor: first.nextCursor ?? '' }))
    assert.deepEqual(second.memories.map(m => m.id), [ids[2], ids[1]])
    const third = listPage(dbs, options({ cursor: second.nextCursor ?? '' }))
    assert.deepEqual([third.memories.map(m => m.id), third.nextCursor], [[ids[0]], null])
    assert.throws(() => listPage(dbs, options({ cursor: 'not-a-cursor' })), /the cursor is not one a listing wrote/)
    w.close()
  })

  test('a text filter folds case beyond ASCII, and the counts cover every status', async () => {
    const w = world()
    const city = (await w.remember({ text: 'Staging servers live in the İSTANBUL region' })).memory
    await w.remember({ text: 'Production servers live in the Frankfurt region' })
    assert.deepEqual(listPage([w.project.db], options({ query: 'i̇stanbul', limit: 10 })).memories.map(m => m.id), [city.id])
    const stats = storeStats(w.project.db)
    assert.deepEqual([stats.total, stats.byStatus.active, stats.byStatus.deleted], [2, 2, 0])
    w.close()
  })
})
