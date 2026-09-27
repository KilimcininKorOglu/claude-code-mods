import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { Memory } from '../../hooks/shared/model.ts'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { createEmbeddings } from '../embeddings.ts'
import { fuse, lexicalHits } from '../fusion.ts'
import { hitRelevance, memorySemanticRelevance } from '../relevance.ts'
import { remember } from '../remember.ts'
import { rankForPrompt, rankForTools } from '../remind.ts'
import { EVERY_POLICY, REMINDED_POLICY, type Visibility } from '../search.ts'
import { createSetup } from '../setup.ts'
import { createStores, transaction, type Store } from '../stores.ts'
import { updateMemory } from '../update.ts'
import { unembedded, vectorHits } from '../vectors.ts'
import { fakeRuntime, queryOf, toward } from './fake-runtime.ts'
import { cleanUp, tempDir, waitFor } from './support.ts'
import { world } from './world.ts'

after(cleanUp)

const SHOWN: Visibility = { statuses: ['active'], policies: EVERY_POLICY, audienceScoped: true }
const POOL = 'The connection pool keeps twenty sockets for each worker'
const DEPLOYS = 'Deploys go through the staging branch before production'

function memoryOf(id: string, text = `Memory ${id} holds a fact about the build`): Memory {
  return {
    id,
    revision: 1,
    scope: 'project',
    kind: 'fact',
    status: 'active',
    contextPolicy: 'auto',
    persistence: 'long_lived',
    text,
    importance: 0.6,
    confidence: 0.8,
    freshness: 1,
    tags: [],
    anchors: [],
    sources: [{ type: 'user' }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

describe('semantic relevance', () => {
  test('the pivot is the relation floor, the floor the prompt threshold, and semantics stays below an exact anchor', () => {
    assert.deepEqual(memorySemanticRelevance(0.5), { strength: 0.85, reasons: ['query:semantic-cosine:0.50'] })
    assert.equal(memorySemanticRelevance(0.46).strength.toFixed(2), '0.62')
    assert.equal(memorySemanticRelevance(0.72).strength, 0.94)
    assert.deepEqual(memorySemanticRelevance(0.3), { strength: 0, reasons: [] }, 'a cosine where unrelated questions land is no evidence')
    assert.deepEqual(memorySemanticRelevance(null), { strength: 0, reasons: [] })
  })

  test('a hit is as relevant as its stronger channel, with the reasons of both', () => {
    const relevance = hitRelevance({ memory: memoryOf('M1', POOL), vectorScore: 0.6 }, 'sockets')
    assert.deepEqual(relevance, { strength: 0.94, reasons: ['query:text-terms:sockets', 'query:semantic-cosine:0.60'] })
  })
})

describe('fusion', () => {
  test('a vector hit lifts a memory the text index found; one it missed enters only from the floor', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(id => memoryOf(id))
    const fused = fuse([a!, b!], [{ memory: c!, cosine: 0.47 }, { memory: d!, cosine: 0.4 }, { memory: b!, cosine: 0.3 }], 10)
    assert.deepEqual(
      fused.map(hit => [hit.memory.id, hit.source, hit.vectorScore]),
      [
        ['B', 'both', 0.3],
        ['A', 'lexical', null],
        ['C', 'vector', 0.47],
      ],
    )
  })

  test('at most twelve memories enter from the vector channel alone, and a text-only list is scored by place', () => {
    const alone = Array.from({ length: 13 }, (_, index) => ({ memory: memoryOf(`V${index}`), cosine: 0.9 - index * 0.01 }))
    assert.equal(fuse([], alone, 50).length, 12)
    assert.deepEqual(
      lexicalHits([memoryOf('A'), memoryOf('B'), memoryOf('C')]).map(hit => hit.finalScore),
      [1, 0.5, 0],
    )
  })
})

describe('vectors in a store', () => {
  test('a write embeds its memory; a changed text is skipped until a fill embeds it again', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    fake.vectors.set(POOL, toward(0, 1))
    const { memory } = await w.remember({ text: POOL })
    await embeddings.afterWrite(w.project, [memory])
    const query = queryOf(toward(0, 0.8))
    assert.deepEqual(
      vectorHits(w.project.db, query, SHOWN, 10).map(hit => [hit.memory.id, hit.cosine.toFixed(2)]),
      [[memory.id, '0.80']],
    )
    const renamed = 'The connection pool keeps forty sockets for each worker thread'
    await w.run(op => updateMemory(op, { id: memory.id, patch: { text: renamed } }))
    assert.deepEqual(vectorHits(w.project.db, query, SHOWN, 10), [], 'the vector of the old text is stale')
    assert.deepEqual(unembedded(w.project.db, 'fake/model').map(m => m.id), [memory.id])
    fake.vectors.set(renamed, toward(0, 1))
    assert.equal(await embeddings.fill(w.project), 1)
    assert.equal(vectorHits(w.project.db, query, SHOWN, 10).length, 1)
    w.close()
  })

  test('the vector channel sees what a reminder may see, and no more', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const texts = [
      'Pool sizing is private to the operators',
      'Pool sizing questions go to the explore agent',
      'Pool sizing was measured in another session',
      'Pool sizing below eight starves the worker sockets',
    ]
    texts.forEach(text => fake.vectors.set(text, toward(0, 1)))
    const written: Memory[] = []
    written.push((await w.remember({ text: texts[0]!, contextPolicy: 'never' })).memory)
    written.push((await w.remember({ text: texts[1]!, audience: { roles: ['explore'] } })).memory)
    written.push((await w.remember({ text: texts[2]!, scope: 'session', ownerSessionId: 's2' })).memory)
    const plain = (await w.remember({ text: texts[3]! })).memory
    written.push(plain)
    await embeddings.afterWrite(w.project, written)
    const reminded: Visibility = { statuses: ['active'], policies: REMINDED_POLICY, audienceScoped: false, sessionId: 's1' }
    assert.deepEqual(vectorHits(w.project.db, queryOf(toward(0, 0.9)), reminded, 10).map(hit => hit.memory.id), [plain.id])
    w.close()
  })
})

describe('the embeddings service', () => {
  test('off without the runtime, loaded at the first query once installed, and a failure is kept as the state', async () => {
    const fake = fakeRuntime(false)
    const embeddings = createEmbeddings(fake)
    assert.deepEqual(embeddings.state(), { state: 'off' })
    assert.equal(await embeddings.semantic('pool sizing', []), undefined)
    fake.present = true
    assert.deepEqual(embeddings.state(), { state: 'available' })
    fake.failLoad = 'the model file is broken'
    assert.equal(await embeddings.semantic('pool sizing', []), undefined)
    assert.deepEqual(embeddings.state(), { state: 'failed', error: 'loading the model failed: the model file is broken' })
    assert.equal(await embeddings.semantic('pool sizing', []), undefined)
    assert.deepEqual(
      fake.loads.map(load => load.allowRemote),
      [false],
      'a failed state loads nothing again, and a load outside setup never downloads',
    )
    await embeddings.load(true, () => undefined)
    assert.deepEqual(embeddings.state(), { state: 'ready', modelId: 'fake/model', dims: 16 })
    fake.failNext = 'the inference crashed'
    assert.equal(await embeddings.semantic('pool sizing', []), undefined)
    assert.deepEqual(embeddings.state(), { state: 'failed', error: 'embedding a query failed: the inference crashed' })
  })

  test('a query fills the stores it names once, in the background', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    await w.remember({ text: POOL })
    await w.remember({ text: DEPLOYS })
    await embeddings.semantic('pool sizing', [w.project])
    await waitFor(() => !embeddings.busy(), 2000, 'the background fill')
    await embeddings.semantic('deploy order', [w.project])
    await waitFor(() => !embeddings.busy(), 2000, 'a second fill')
    assert.deepEqual(fake.embedded, ['pool sizing', DEPLOYS, POOL, 'deploy order'], 'the store was filled once, newest change first')
    w.close()
  })
})

describe('reminders through the vector channel', () => {
  test('a prompt in another language reaches an important memory through the vector channel alone', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const anchors = [{ type: 'file' as const, path: 'src/app.ts' }]
    const vpn = (await w.remember({ text: 'Staging deploys need the VPN profile named ops-eu', importance: 0.9, confidence: 0.9, anchors })).memory
    const banner = (await w.remember({ text: 'A staging banner shows on every page of the preview site', importance: 0.9, confidence: 0.9, anchors })).memory
    fake.vectors.set(vpn.text, toward(0, 1))
    fake.vectors.set(banner.text, toward(2, 1))
    await embeddings.afterWrite(w.project, [vpn, banner])
    const prompt = 'yayına çıkmadan önce hangi bağlantı profilini açmalıyım'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.6
    vector[1] = Math.sqrt(1 - 0.36 - 0.16)
    vector[2] = 0.4
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8 })
    assert.deepEqual(ranking.candidates.map(c => [c.memory.id, c.reasons]), [[vpn.id, ['query:semantic-cosine:0.60']]])
    assert.deepEqual(ranking.rejected, [], 'the banner at 0.40 is under the floor, so it never became a candidate')
    w.close()
  })

  test('a tool reminder takes a vector hit through the relation floor only from the pivot up', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const close = (await w.remember({ text: 'Invoices are numbered per tenant and never reuse a number' })).memory
    const loose = (await w.remember({ text: 'Receipts print the store address in the footer' })).memory
    fake.vectors.set(close.text, toward(0, 1))
    fake.vectors.set(loose.text, toward(2, 1))
    await embeddings.afterWrite(w.project, [close, loose])
    const query = 'src/billing/ledger.ts ledger.ts ledger billing'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.55
    vector[2] = 0.48
    vector[1] = Math.sqrt(1 - 0.55 * 0.55 - 0.48 * 0.48)
    fake.vectors.set(query, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(query, []) }
    const ranking = rankForTools(readers, { paths: [], query, mutation: false, limit: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [close.id])
    assert.match(ranking.rejected.find(r => r.id === loose.id)?.reason ?? '', /relation 0\.73 is below 0\.85/)
    w.close()
  })
})

function projectRef(dir: string, name: string): ProjectRef {
  return { key: `${name}-0000aaaa`, name, root: join(dir, name), commonDir: join(dir, name, '.git') }
}

async function rememberIn(store: Store, root: string | undefined, text: string): Promise<void> {
  await transaction(store, () => remember({ store, root, now: new Date().toISOString() }, { text, scope: root === undefined ? 'user' : 'project' }))
}

describe('the setup job', () => {
  test('installs, downloads the model, then embeds the memories of every store on disk', async () => {
    const dir = tempDir()
    const stores = createStores(dir)
    const alpha = projectRef(dir, 'alpha')
    const beta = projectRef(dir, 'beta')
    await rememberIn(stores.project(alpha), alpha.root, POOL)
    await rememberIn(stores.project(beta), beta.root, DEPLOYS)
    await rememberIn(stores.global(), undefined, 'Prefer tabs over spaces in every editor')
    stores.closeAll()
    const fake = fakeRuntime(false)
    const embeddings = createEmbeddings(fake)
    const setup = createSetup({ dir, runtime: fake, embeddings, stores })
    const started = setup.start()
    assert.equal(started.state, 'running')
    assert.deepEqual(setup.start(), started, 'a start while the job runs answers the running job')
    await waitFor(() => !setup.running(), 5000, 'the setup job')
    const job = setup.job()
    assert.deepEqual([job.state, job.state === 'done' && job.indexed], ['done', 3])
    assert.deepEqual([fake.installs, fake.loads.map(load => load.allowRemote)], [1, [true]])
    stores.closeAll()
  })

  test('a failed step is the job state, with the step and the reason', async () => {
    const dir = tempDir()
    const stores = createStores(dir)
    const fake = fakeRuntime()
    fake.failLoad = 'no network'
    const setup = createSetup({ dir, runtime: fake, embeddings: createEmbeddings(fake), stores })
    setup.start()
    await waitFor(() => !setup.running(), 5000, 'the setup job')
    const job = setup.job()
    assert.deepEqual([job.state, job.state === 'failed' && job.step, job.state === 'failed' && job.error], ['failed', 'download', 'no network'])
    assert.equal(fake.installs, 0, 'an installed package is not installed again')
    stores.closeAll()
  })

  test('a project.json that names another store stops the index step and names the file', async () => {
    const dir = tempDir()
    const stores = createStores(dir)
    const broken = join(dir, 'broken-0000aaaa')
    mkdirSync(broken)
    writeFileSync(join(broken, 'project.json'), JSON.stringify({ key: 'other-0000aaaa', name: 'other', root: '/tmp/other', commonDir: '/tmp/other/.git' }))
    const fake = fakeRuntime()
    const setup = createSetup({ dir, runtime: fake, embeddings: createEmbeddings(fake), stores })
    setup.start()
    await waitFor(() => !setup.running(), 5000, 'the setup job')
    const job = setup.job()
    assert.equal(job.state === 'failed' && job.step, 'index')
    assert.equal(job.state === 'failed' && job.error, `${join(broken, 'project.json')} does not describe the project store it sits in`)
    stores.closeAll()
  })
})
