import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { markReminded, nextEpoch } from '../contexts.ts'
import { alwaysFor, rankForPrompt, rankForSubagent, rankForTools, type ToolsRequest } from '../remind.ts'
import { updateMemory } from '../update.ts'
import { cleanUp } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

const READ_APP: ToolsRequest = { paths: ['src/app.ts'], query: 'src/app.ts app.ts app', mutation: false, limit: 8 }

describe('a reminder after a tool batch', () => {
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

  test('the gates hold back a low importance, a never or always policy, and a repeated text', async () => {
    const w = world()
    const anchors = [{ type: 'file' as const, path: 'src/app.ts' }]
    const minor = (await w.remember({ text: 'The app entry has a comment about the old logo', anchors, importance: 0.3 })).memory
    await w.remember({ text: 'The app entry holds the license banner', anchors, contextPolicy: 'never' })
    await w.remember({ text: 'The app entry is the only place that reads process.env', anchors, contextPolicy: 'always' })
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
    const ranking = rankForPrompt(w.readers('s1', 'main'), { query: 'how do I deploy to staging over the vpn', limit: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [important.id])
    assert.ok(ranking.rejected.every(r => r.gate === 'belowScore'))
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

describe('the always block', () => {
  test('active always memories of both stores with no audience, most important first', async () => {
    const w = world()
    const project = (await w.remember({ text: 'Commit through the commit skill only', contextPolicy: 'always', importance: 0.7 })).memory
    const user = (await w.remember({ text: 'Answer in the language of the question', scope: 'user', contextPolicy: 'always', importance: 0.95 }, w.global)).memory
    await w.remember({ text: 'Explore agents always read the ADRs', contextPolicy: 'always', audience: { roles: ['explore'] } })
    const archived = (await w.remember({ text: 'Use npm for every install', contextPolicy: 'always' })).memory
    await w.run(op => updateMemory(op, { id: archived.id, patch: { status: 'archived' } }))
    assert.deepEqual(alwaysFor(w.readers('s1'), 100).map(m => m.id), [user.id, project.id])
    w.close()
  })
})
