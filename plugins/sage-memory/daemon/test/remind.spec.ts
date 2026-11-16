import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { markReminded, nextEpoch } from '../contexts.ts'
import { rankForPrompt, rankForSubagent, rankForTools, type ToolsRequest } from '../remind.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

const READ_APP: ToolsRequest = { paths: ['src/app.ts'], query: 'src/app.ts app.ts app', mutation: false, limit: 8 }

describe("a reminder on a file tool's result", () => {
  test('a memory anchored to the touched file is a candidate; one word in common is not evidence enough', async () => {
    const w = world()
    const anchored = (await w.remember({ text: 'The app entry must register the router before the store', anchors: [{ type: 'file', path: 'src/app.ts' }] })).memory
    const loose = (await w.remember({ text: 'The app store for mobile releases needs a new screenshot set' })).memory
    const ranking = rankForTools(w.readers('s1', 'main'), READ_APP)
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [anchored.id])
    assert.deepEqual(ranking.candidates[0]?.reasons, ['anchor:exact-file:src/app.ts', 'query:exact-file'], 'the path channel and the query both found it')
    assert.match(ranking.rejected.find(r => r.id === loose.id)?.reason ?? '', /relation 0\.66 is below 0\.85/, 'one word of a two-word query')
    w.close()
  })

  test('a memory anchored to a directory above the touched file is a candidate, a top-level directory too', async () => {
    const w = world()
    const top = (await w.remember({ text: 'Every module under src exports named bindings only', anchors: [{ type: 'directory', path: 'src' }] })).memory
    const other = (await w.remember({ text: 'Every script under tools runs with the repository root as its directory', anchors: [{ type: 'directory', path: 'tools' }] })).memory
    const ranking = rankForTools(w.readers('s1', 'main'), READ_APP)
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [top.id])
    assert.deepEqual(ranking.candidates[0]?.reasons.slice(0, 1), ['anchor:ancestor:src+1'])
    assert.ok(!ranking.rejected.some(r => r.id === top.id))
    assert.ok(!ranking.candidates.some(c => c.memory.id === other.id), 'a directory the path is not under relates to nothing')
    w.close()
  })

  test('a memory on a directory right under the root is no candidate for a file two levels below it', async () => {
    const w = world()
    const broad = (await w.remember({ text: 'Every mod keeps its own Makefile and README pair', anchors: [{ type: 'directory', path: 'plugins' }] })).memory
    const own = (await w.remember({ text: 'The restore mod watches only markdown files', anchors: [{ type: 'directory', path: 'plugins/restore' }] })).memory
    const path = 'plugins/restore/README.md'
    const ranking = rankForTools(w.readers('s1', 'main'), { paths: [path], query: 'plugins restore README md', mutation: false, limit: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [own.id])
    assert.equal(ranking.rejected.find(r => r.id === broad.id)?.gate, 'belowScore')
    w.close()
  })

  test('a memory anchored to the file itself stays a candidate however many important memories its directory holds', async () => {
    const w = world()
    for (let i = 0; i < 20; i++) await w.remember({ text: `Module rule number ${i} for the source tree`, anchors: [{ type: 'directory', path: 'src' }], importance: 0.9, distinct: true })
    const own = (await w.remember({ text: 'The app entry must register the router before the store', anchors: [{ type: 'file', path: 'src/app.ts' }], importance: 0.6 })).memory
    // The hooks spell a path as words, so the query alone does not find the file's memory.
    const ranking = rankForTools(w.readers('s1', 'main'), { ...READ_APP, query: 'src app ts' })
    assert.ok(ranking.candidates.some(c => c.memory.id === own.id), 'the file\'s own memory is not cut before its relation is weighed')
    w.close()
  })

  test("the file's own memory ranks first, above more important memories of a directory above it", async () => {
    const w = world()
    for (let i = 0; i < 3; i++) await w.remember({ text: `Source tree rule ${i}: keep every module free of side effects`, anchors: [{ type: 'directory', path: 'src' }], importance: 1, persistence: 'permanent', distinct: true })
    const own = (await w.remember({ text: 'The app entry must register the router before the store', anchors: [{ type: 'file', path: 'src/app.ts' }], importance: 0.6 })).memory
    const ranking = rankForTools(w.readers('s1', 'main'), { ...READ_APP, query: 'src app ts' })
    assert.equal(ranking.candidates[0]?.memory.id, own.id, 'a stronger relation outranks a higher importance')
    w.close()
  })

  test('a memory anchored to a directory above the file ranks before one only the query words found', async () => {
    const w = world()
    // The command anchor `server` is spelled by the path words by accident, an exact query match.
    const worded = (await w.remember({ text: 'Start the dev server with the watch flag', anchors: [{ type: 'command', command: 'server' }] })).memory
    const placed = (await w.remember({ text: 'Handlers under lib/server return plain objects, never responses', anchors: [{ type: 'directory', path: 'lib/server' }] })).memory
    const path = 'lib/server/routes/user.ts'
    const ranking = rankForTools(w.readers('s1', 'main'), { paths: [path], query: 'lib server routes user ts', mutation: false, limit: 8 })
    const ids = ranking.candidates.map(c => c.memory.id)
    assert.ok(ids.includes(worded.id), 'the query match is still a candidate')
    assert.ok(ids.indexOf(placed.id) < ids.indexOf(worded.id), 'where a memory is anchored outranks what the path words happen to match')
    w.close()
  })

  test('an anchor too far above the file to relate on its own does not count as placing the memory there', async () => {
    const w = world()
    // `lib` lies three levels above the file, past its reach; the query lifts the memory through its command anchor.
    const far = (await w.remember({ text: 'Start the dev server with the watch flag', anchors: [{ type: 'directory', path: 'lib' }, { type: 'command', command: 'server' }] })).memory
    const near = (await w.remember({ text: 'Handlers under lib/server return plain objects, never responses', anchors: [{ type: 'directory', path: 'lib/server' }] })).memory
    const ranking = rankForTools(w.readers('s1', 'main'), { paths: ['lib/server/routes/user.ts'], query: 'lib server routes user ts', mutation: false, limit: 8 })
    const ids = ranking.candidates.map(c => c.memory.id)
    assert.ok(ids.includes(far.id))
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id), 'only an anchor that relates on its own places a memory')
    w.close()
  })

  test('the gates hold back a low importance, a never policy, and a repeated text', async () => {
    const w = world()
    const anchors = [{ type: 'file' as const, path: 'src/app.ts' }]
    const minor = (await w.remember({ text: 'The app entry has a comment about the old logo', anchors, importance: 0.3 })).memory
    await w.remember({ text: 'The app entry holds the license banner', anchors, contextPolicy: 'never' })
    const project = (await w.remember({ text: 'The app entry is started by the dev server', anchors })).memory
    await w.remember({ text: 'The app entry is started by the dev server', scope: 'user' }, w.global)
    const ranking = rankForTools(w.readers('s1', 'main'), { ...READ_APP, query: 'The app entry is started by the dev server' })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [project.id])
    assert.equal(ranking.rejected.find(r => r.id === minor.id)?.gate, 'belowScore')
    assert.ok(ranking.rejected.some(r => r.gate === 'duplicate'), 'the user memory with the same text is one reminder')
    w.close()
  })

  test('a change reminds of a stale memory too, a read does not', async () => {
    const w = world()
    const { memory } = await w.remember({ text: 'The app entry exports a default handler', anchors: [{ type: 'file', path: 'src/app.ts' }] })
    await w.run(op => updateMemory(op, { id: memory.id, patch: { status: 'stale' } }))
    assert.equal(rankForTools(w.readers('s1', 'main'), READ_APP).candidates.length, 0)
    assert.equal(rankForTools(w.readers('s1', 'main'), { ...READ_APP, mutation: true }).candidates[0]?.memory.id, memory.id)
    w.close()
  })

  test('a graph neighbour sharing an anchor with the strongest find comes along', async () => {
    const w = world()
    await w.remember({ text: 'The app entry and the router boot in one tick', anchors: [{ type: 'file', path: 'src/app.ts' }, { type: 'file', path: 'src/router.ts' }] })
    const neighbour = (await w.remember({ text: 'Routes register themselves with a side-effect import', anchors: [{ type: 'file', path: 'src/router.ts' }] })).memory
    const ranking = rankForTools(w.readers('s1', 'main'), READ_APP)
    const found = ranking.candidates.find(c => c.memory.id === neighbour.id)
    assert.deepEqual(found?.reasons, ['graph:shared-anchor:file:src/router.ts'])
    w.close()
  })

  test('a memory related to the strongest find comes along with no shared anchor, and stays away once unlinked', async () => {
    const w = world()
    const neighbour = (await w.remember({ text: 'Session tokens rotate every twelve hours on the auth service' })).memory
    const seed = (await w.remember({ text: 'The app entry must register the router before the store', anchors: [{ type: 'file', path: 'src/app.ts' }], related: [neighbour.id] })).memory
    const linked = rankForTools(w.readers('s1', 'main'), READ_APP)
    assert.deepEqual(linked.candidates.find(c => c.memory.id === neighbour.id)?.reasons, [`graph:related:${seed.id}`])
    await w.run(op => updateMemory(op, { id: seed.id, patch: { related: [] } }))
    assert.ok(!rankForTools(w.readers('s1', 'main'), READ_APP).candidates.some(c => c.memory.id === neighbour.id))
    w.close()
  })

  test('a context is reminded of a memory once, until it starts over', async () => {
    const w = world()
    const { memory } = await w.remember({ text: 'The app entry must register the router before the store', anchors: [{ type: 'file', path: 'src/app.ts' }] })
    await w.run(op => markReminded(op, { sessionId: 's1', loop: 'main', ids: [memory.id], trigger: 'tool_batch' }))
    const again = rankForTools(w.readers('s1', 'main'), READ_APP)
    assert.deepEqual([again.candidates.length, again.rejected[0]?.gate], [0, 'reminded'])
    assert.equal(rankForTools(w.readers('s1', 'agent-7'), READ_APP).candidates.length, 1, "a subagent's context is its own")
    assert.equal(await w.run(op => nextEpoch(op, 's1', 'main')), 1)
    assert.equal(rankForTools(w.readers('s1', 'main'), READ_APP).candidates.length, 1, 'a compaction starts the context over')
    w.close()
  })
})

describe('a reminder with the prompt', () => {
  test('an important memory the prompt is about passes; a default one with thin evidence does not', async () => {
    const w = world()
    const important = (await w.remember({ text: 'Staging deploys need the VPN profile named ops-eu', importance: 0.9, confidence: 0.9, tags: ['deploy'] })).memory
    await w.remember({ text: 'A staging banner shows on every page of the preview site' })
    const ranking = rankForPrompt(w.readers('s1', 'main'), { query: 'how do I deploy to staging over the vpn', limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [important.id])
    assert.ok(ranking.rejected.every(r => r.gate === 'belowScore'))
    w.close()
  })

  test('without embeddings, a default memory one shared word relates to stays out', async () => {
    const w = world()
    const loose = (await w.remember({ text: 'A staging banner shows on every page of the preview site' })).memory
    const ranking = rankForPrompt(w.readers('s1', 'main'), { query: 'banner', limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates, [], 'words are the only evidence here, so the score still weighs how important the memory is')
    assert.equal(ranking.rejected.find(r => r.id === loose.id)?.gate, 'belowScore')
    w.close()
  })
})

describe('what a subagent starts with', () => {
  test('the memories for its role, then the ones its task finds', async () => {
    const w = world()
    const role = (await w.remember({ text: 'Explore agents read the ADR folder first', audience: { roles: ['explore'] } })).memory
    const user = (await w.remember({ text: 'Explore agents answer with file paths and line numbers', scope: 'user', audience: { roles: ['explore'] }, importance: 0.9 }, w.global)).memory
    const task = (await w.remember({ text: 'Payment webhooks retry with exponential backoff up to six times', importance: 0.9, confidence: 0.9, anchors: [{ type: 'file', path: 'src/app.ts' }] })).memory
    const start = rankForSubagent(w.readers('s1'), { role: 'Explore', task: 'find where payment webhooks retry', audienceLimit: 20, taskLimit: 8 })
    assert.deepEqual(start.audience.map(m => m.id), [user.id, role.id])
    assert.deepEqual(start.task.map(c => c.memory.id), [task.id])
    w.close()
  })
})
