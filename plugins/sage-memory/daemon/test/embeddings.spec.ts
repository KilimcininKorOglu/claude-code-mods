import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { Memory, RememberInput } from '../../hooks/shared/model.ts'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import { closePairs } from '../close-pairs.ts'
import { createEmbeddings } from '../embeddings.ts'
import { fuse, lexicalHits } from '../fusion.ts'
import { searchHybrid } from '../hybrid.ts'
import { hitRelevance, MEANING_FLOOR_COSINE, memorySemanticRelevance } from '../relevance.ts'
import { remember, SIMILAR_COSINE } from '../remember.ts'
import { rankForPrompt, rankForTools } from '../remind.ts'
import { EVERY_POLICY, REMINDED_POLICY, type Visibility } from '../search.ts'
import { createSetup } from '../setup.ts'
import { createStores, transaction, type Store } from '../stores.ts'
import { updateMemory } from '../update.ts'
import { dropMemory } from '../move.ts'
import { sql } from '../rows.ts'
import { sentencesOf, unembedded, vectorHits, type SemanticQuery } from '../vectors.ts'
import { fakeRuntime, queryOf, toward } from './fake-runtime.ts'
import { cleanUp, tempDir, waitFor } from './support.ts'
import { world, type World } from './world.ts'

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
    assert.deepEqual(memorySemanticRelevance(0.6), { strength: 0.85, reasons: ['query:semantic-cosine:0.60'] })
    assert.equal(memorySemanticRelevance(0.55).strength.toFixed(2), '0.62')
    assert.equal(memorySemanticRelevance(0.72).strength, 0.94)
    assert.deepEqual(memorySemanticRelevance(0.4), { strength: 0, reasons: [] }, 'a cosine where unrelated questions land is no evidence')
    assert.deepEqual(memorySemanticRelevance(null), { strength: 0, reasons: [] })
  })

  test('a hit is as relevant as its stronger channel, with the reasons of both', () => {
    const relevance = hitRelevance({ memory: memoryOf('M1', POOL), vectorScore: 0.7 }, 'sockets')
    assert.deepEqual(relevance, { strength: 0.94, reasons: ['query:text-terms:sockets', 'query:semantic-cosine:0.70'] })
  })
})

describe('fusion', () => {
  test('a vector hit lifts a memory the text index found; one it missed enters only above the floor', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(id => memoryOf(id))
    const fused = fuse([a!, b!], [{ memory: c!, cosine: 0.56 }, { memory: d!, cosine: 0.5 }, { memory: b!, cosine: 0.3 }], 10, 0.55)
    assert.deepEqual(
      fused.map(hit => [hit.memory.id, hit.source, hit.vectorScore]),
      [
        ['B', 'both', 0.3],
        ['A', 'lexical', null],
        ['C', 'vector', 0.56],
      ],
    )
  })

  test('a memory only the vector channel finds enters above the floor it is given, never at it', () => {
    const [a, d, e] = ['A', 'D', 'E'].map(id => memoryOf(id))
    const fused = fuse([a!], [{ memory: d!, cosine: 0.5 }, { memory: e!, cosine: 0.44 }], 10, MEANING_FLOOR_COSINE)
    assert.deepEqual(fused.map(hit => hit.memory.id).sort(), ['A', 'D'])
  })

  test('a search returns a memory whose meaning is above the meaning floor, though no word of the query matches it', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const refunds = (await w.remember({ text: 'Refunds are booked against the original invoice' })).memory
    fake.vectors.set(refunds.text, toward(0, 1))
    await embeddings.afterWrite(w.project, [refunds])
    const query = 'iadeler hangi belgeye yazılıyor'
    fake.vectors.set(query, toward(0, 0.5))
    const readers = w.readers('s1', 'main')
    const hits = searchHybrid([readers.project.store.db, readers.user.store.db], query, SHOWN, 20, await embeddings.semantic(query, []), MEANING_FLOOR_COSINE)
    assert.deepEqual(hits.map(hit => hit.memory.id), [refunds.id])
    w.close()
  })

  test('a memory only the vector channel finds keeps a place when the text index fills the list', () => {
    const text = Array.from({ length: 96 }, (_, index) => memoryOf(`T${index}`))
    const meant = memoryOf('V')
    const fused = fuse(text, [{ memory: meant, cosine: 0.8 }], 48, MEANING_FLOOR_COSINE)
    assert.ok(fused.some(hit => hit.memory.id === 'V'), 'the best vector hit ranks with the best text hit, not behind every one')
  })

  test('at most twelve memories enter from the vector channel alone, and a text-only list is scored by place', () => {
    const alone = Array.from({ length: 13 }, (_, index) => ({ memory: memoryOf(`V${index}`), cosine: 0.9 - index * 0.01 }))
    assert.equal(fuse([], alone, 50, MEANING_FLOOR_COSINE).length, 12)
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

describe('the meaning check of a write', () => {
  const NEW = 'Bir ödeme numarası her kiracı için ayrı sayılır ve tekrar kullanılmaz'

  /** A world with one embedded memory and a fake model that places `NEW` at `cosine` from it. */
  async function seeded(cosine: number, input: Partial<RememberInput> = {}): Promise<{ w: World; old: Memory; query: SemanticQuery | undefined }> {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const old = (await w.remember({ text: 'Invoices are numbered per tenant and never reuse a number', ...input })).memory
    fake.vectors.set(old.text, toward(0, 1))
    fake.vectors.set(NEW, toward(0, cosine))
    await embeddings.afterWrite(w.project, [old])
    return { w, old, query: await embeddings.semantic(NEW, []) }
  }

  test('a write just above the similarity cosine is not written and names the memory', async () => {
    const { w, old, query } = await seeded(SIMILAR_COSINE + 0.01)
    const result = await w.run(op => remember(op, { text: NEW }, query))
    assert.deepEqual(result, { outcome: 'similar', similar: [{ id: old.id, kind: 'fact', text: old.text, cosine: 0.73 }] })
    assert.equal(unembedded(w.project.db, 'fake/model').length, 0, 'no memory was added')
    w.close()
  })

  test('a write below the similarity cosine is written', async () => {
    const { w, query } = await seeded(SIMILAR_COSINE - 0.02)
    assert.equal((await w.run(op => remember(op, { text: NEW }, query))).outcome, 'added')
    w.close()
  })

  test('a distinct write, a write that supersedes the memory, and a write without a vector are written', async () => {
    const { w, old, query } = await seeded(0.95)
    assert.equal((await w.run(op => remember(op, { text: NEW, distinct: true }, query))).outcome, 'added')
    const replacing = await w.run(op => remember(op, { text: 'Fatura sırası kiracı başına tutulur, silinen faturanın numarası boş kalır', supersedes: [old.id] }, query))
    assert.equal(replacing.outcome, 'added')
    assert.equal(w.read(old.id).status, 'superseded')
    assert.equal((await w.run(op => remember(op, { text: 'Credit notes carry their own counter beside the invoice sequence' }))).outcome, 'added')
    w.close()
  })

  test('a memory of another audience or session is not a similar memory', async () => {
    const { w, query } = await seeded(0.95, { audience: { roles: ['explore'] } })
    assert.equal((await w.run(op => remember(op, { text: NEW }, query))).outcome, 'added')
    w.close()
  })

  test('the same text merges as before, whatever its vector says', async () => {
    const { w, old, query } = await seeded(0.95)
    const result = await w.run(op => remember(op, { text: old.text }, query))
    assert.equal(result.outcome, 'merged')
    w.close()
  })
})

describe('sentence vectors', () => {
  const FIRST = 'The worker pool keeps twenty sockets for each worker process.'
  const SECOND = 'Deploys go through the staging branch before they reach production.'
  const LONG = `${FIRST} ${SECOND}`
  const FACT = 'Production deploys pass the staging branch first'

  test('a text splits at sentence ends, joins short pieces, and splits before a Turkish upper-case letter', () => {
    assert.deepEqual(sentencesOf(LONG), [FIRST, SECOND])
    assert.deepEqual(sentencesOf(`${FIRST} Measured on 2.1.283.`), [], 'a short piece joins the sentence before it, which leaves one sentence')
    assert.deepEqual(sentencesOf('Havuz her işçi için yirmi soket tutar ve bunu değiştirmez. Çıkışlar staging dalından geçer ve sonra üretime gider.'), [
      'Havuz her işçi için yirmi soket tutar ve bunu değiştirmez.',
      'Çıkışlar staging dalından geçer ve sonra üretime gider.',
    ])
    assert.deepEqual(sentencesOf(FIRST), [], 'one sentence has no vectors besides the whole text')
  })

  /** A world whose long memory sits far from `FACT` as a whole and close to it in its second sentence. */
  async function seededLong(): Promise<{ w: World; long: Memory; fake: ReturnType<typeof fakeRuntime>; embeddings: ReturnType<typeof createEmbeddings> }> {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    fake.vectors.set(LONG, toward(4, 1))
    fake.vectors.set(FIRST, toward(2, 1))
    fake.vectors.set(SECOND, toward(0, 1))
    fake.vectors.set(FACT, toward(0, 0.9))
    const long = (await w.remember({ text: LONG })).memory
    await embeddings.afterWrite(w.project, [long])
    return { w, long, fake, embeddings }
  }

  test('a fact one sentence of a long memory states holds the write back, while search keeps the whole text', async () => {
    const { w, long, fake, embeddings } = await seededLong()
    assert.deepEqual(fake.embedded, [LONG, FIRST, SECOND], 'the whole text and each sentence were embedded together')
    const query = await embeddings.semantic(FACT, [])
    const result = await w.run(op => remember(op, { text: FACT }, query))
    assert.deepEqual(result, { outcome: 'similar', similar: [{ id: long.id, kind: 'fact', text: LONG, cosine: 0.9 }] })
    assert.deepEqual(
      vectorHits(w.project.db, query!, SHOWN, 10).map(hit => hit.cosine.toFixed(2)),
      ['0.00'],
      'search reads the whole text alone, the scale its relevance was measured on',
    )
    w.close()
  })

  test('a memory without its sentence vectors is filled again, and a changed text makes its sentences stale', async () => {
    const { w, long, fake, embeddings } = await seededLong()
    sql(w.project.db, 'DELETE FROM sentence_vectors').run()
    assert.deepEqual(unembedded(w.project.db, 'fake/model').map(m => m.id), [long.id], 'a store from before sentence vectors gets them')
    assert.equal(await embeddings.fill(w.project), 1)
    assert.equal(unembedded(w.project.db, 'fake/model').length, 0)
    const renamed = `${FIRST} Releases wait for the weekly window and then go out together.`
    await w.run(op => updateMemory(op, { id: long.id, patch: { text: renamed } }))
    fake.vectors.set(renamed, toward(6, 1))
    const query = await embeddings.semantic(FACT, [])
    assert.equal((await w.run(op => remember(op, { text: FACT }, query))).outcome, 'added', 'the old sentence vectors are skipped')
    w.close()
  })

  test('triage gets the pair whose sentences are close, never a pair of another audience or a far one', async () => {
    const { w, long, fake, embeddings } = await seededLong()
    const fact = (await w.remember({ text: FACT, distinct: true })).memory
    const hidden = (await w.remember({ text: `${FACT} for the explore agent`, audience: { roles: ['explore'] }, distinct: true })).memory
    fake.vectors.set(hidden.text, toward(0, 0.95))
    const far = (await w.remember({ text: 'Credit notes carry their own counter', distinct: true })).memory
    await embeddings.afterWrite(w.project, [fact, hidden, far])
    const pairs = await closePairs(w.project.db, 'fake/model')
    assert.deepEqual(pairs.map(pair => [[pair.a, pair.b].sort(), pair.cosine]), [[[long.id, fact.id].sort(), 0.9]], 'ids made in one millisecond sort in no fixed order')
    w.close()
  })

  test('a purged memory and a memory gone from the store leave no sentence vectors', async () => {
    const { w, long } = await seededLong()
    const count = (): unknown => sql(w.project.db, 'SELECT COUNT(*) AS n FROM sentence_vectors').get()?.n
    assert.equal(count(), 2)
    await w.run(op => dropMemory(op, long.id))
    assert.equal(count(), 0)
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
    vector[1] = Math.sqrt(1 - 0.36 - 0.39 * 0.39)
    vector[2] = 0.39
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => [c.memory.id, c.reasons]), [[vpn.id, ['query:semantic-cosine:0.60']]])
    assert.deepEqual(ranking.rejected, [], 'the banner at 0.39 is under the noise floor, so it never became a candidate')
    w.close()
  })

  test('a memory without a vector yet still reaches a prompt through its words, behind the score gate', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    // Neither memory is embedded: their vectors wait for the next fill.
    const important = (await w.remember({ text: 'Staging deploys need the VPN profile named ops-eu', importance: 0.9, confidence: 0.9, tags: ['deploy', 'vpn'] })).memory
    const loose = (await w.remember({ text: 'A staging banner shows on every page of the preview site' })).memory
    const prompt = 'staging deploy vpn profile'
    fake.vectors.set(prompt, toward(4, 1))
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [important.id], 'a missing vector is no evidence against a memory; its words decide, and the score keeps the weak one out')
    assert.ok(!ranking.candidates.some(c => c.memory.id === loose.id))
    w.close()
  })

  test('a prompt reminder takes a default memory the meaning matches, closer meaning first whatever the importance', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const plain = (await w.remember({ text: 'Invoices are numbered per tenant and never reuse a number' })).memory
    const weighty = (await w.remember({ text: 'Receipts print the store address in the footer', importance: 1, confidence: 1 })).memory
    fake.vectors.set(plain.text, toward(0, 1))
    fake.vectors.set(weighty.text, toward(2, 1))
    await embeddings.afterWrite(w.project, [plain, weighty])
    const prompt = 'fatura numaraları nasıl veriliyor'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.8
    vector[2] = 0.6
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [plain.id, weighty.id], 'importance 0.6 and no anchor do not hold back a 0.80 match, and it ranks before a 0.60 one')
    w.close()
  })

  test('with embeddings, shared words alone bring no memory to a prompt, while a named anchor still does', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const worded = (await w.remember({ text: 'The staging deploy banner shows on every preview page', importance: 0.9, tags: ['staging', 'deploy'] })).memory
    const named = (await w.remember({ text: 'createPool retries a lost socket three times', anchors: [{ type: 'symbol', path: 'src/net.ts', symbol: 'createPool' }] })).memory
    fake.vectors.set(worded.text, toward(0, 1))
    fake.vectors.set(named.text, toward(2, 1))
    await embeddings.afterWrite(w.project, [worded, named])
    const prompt = 'staging deploy createPool'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.3
    vector[2] = 0.3
    vector[4] = Math.sqrt(1 - 0.18)
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [named.id], 'two shared words and tags at a cosine of 0.30 are no relation; the named symbol is')
    w.close()
  })

  test('a memory the prompt names only through an anchor comes before every memory its meaning brings', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const anchored = (await w.remember({ text: 'Lost sockets are retried three times', anchors: [{ type: 'symbol', path: 'src/net.ts', symbol: 'createPool' }] })).memory
    fake.vectors.set(anchored.text, toward(0, 1))
    const meant: Memory[] = []
    for (const word of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']) {
      const memory = (await w.remember({ text: `The ${word} network keeps its own connection settings`, distinct: true })).memory
      fake.vectors.set(memory.text, toward(2, 1))
      meant.push(memory)
    }
    await embeddings.afterWrite(w.project, [anchored, ...meant])
    const prompt = 'why does createPool give up'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.3
    vector[2] = 0.6
    vector[4] = Math.sqrt(1 - 0.09 - 0.36)
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.equal(ranking.candidates[0]?.memory.id, anchored.id, 'the symbol the prompt names outranks eight memories at a cosine of 0.60')
    w.close()
  })

  test('a memory whose command anchor the prompt spells out comes before every memory its meaning brings', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const anchored = (await w.remember({ text: 'The bench prints one table per store language', anchors: [{ type: 'command', command: 'make bench' }] })).memory
    fake.vectors.set(anchored.text, toward(0, 1))
    const meant: Memory[] = []
    for (const word of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']) {
      const memory = (await w.remember({ text: `The ${word} report keeps its own column order`, distinct: true })).memory
      fake.vectors.set(memory.text, toward(2, 1))
      meant.push(memory)
    }
    await embeddings.afterWrite(w.project, [anchored, ...meant])
    const prompt = 'what does make bench print'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.3
    vector[2] = 0.6
    vector[4] = Math.sqrt(1 - 0.09 - 0.36)
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.equal(ranking.candidates[0]?.memory.id, anchored.id, 'the command the prompt spells out outranks eight memories at a cosine of 0.60')
    w.close()
  })

  test('a prompt reminder takes meaning alone above the meaning floor, shared words between the noise floor and it, and neither under the noise floor', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const near = (await w.remember({ text: 'Refunds are booked against the original invoice' })).memory
    const quiet = (await w.remember({ text: 'Invoices are numbered per tenant and never reuse a number' })).memory
    const worded = (await w.remember({ text: 'The staging deploy banner shows on every preview page', importance: 0.9, tags: ['staging', 'deploy'] })).memory
    const far = (await w.remember({ text: 'Staging deploy keys rotate every quarter', importance: 0.9, tags: ['staging', 'deploy'] })).memory
    for (const [memory, axis] of [[near, 0], [quiet, 2], [worded, 4], [far, 6]] as const) fake.vectors.set(memory.text, toward(axis, 1))
    await embeddings.afterWrite(w.project, [near, quiet, worded, far])
    const prompt = 'staging deploy'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.5
    vector[2] = 0.43
    vector[4] = 0.43
    vector[6] = 0.39
    vector[7] = Math.sqrt(1 - 0.5 * 0.5 - 2 * 0.43 * 0.43 - 0.39 * 0.39)
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [near.id, worded.id])
    w.close()
  })

  test('a prompt reminder puts the closer meaning first, whatever words a farther memory shares with the prompt', async () => {
    const w = world()
    const fake = fakeRuntime()
    const embeddings = createEmbeddings(fake)
    const worded = (await w.remember({ text: 'The staging deploy banner shows on every preview page', importance: 0.9, tags: ['staging', 'deploy'] })).memory
    const meant = (await w.remember({ text: 'Releases wait for the sign-off of the product owner' })).memory
    fake.vectors.set(worded.text, toward(0, 1))
    fake.vectors.set(meant.text, toward(2, 1))
    await embeddings.afterWrite(w.project, [worded, meant])
    const prompt = 'staging deploy'
    const vector = new Array<number>(16).fill(0)
    vector[0] = 0.45
    vector[2] = 0.5
    vector[4] = Math.sqrt(1 - 0.45 * 0.45 - 0.5 * 0.5)
    fake.vectors.set(prompt, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(prompt, []) }
    const ranking = rankForPrompt(readers, { query: prompt, limit: 8, blockCount: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [meant.id, worded.id])
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
    vector[0] = 0.65
    vector[2] = 0.57
    vector[1] = Math.sqrt(1 - 0.65 * 0.65 - 0.57 * 0.57)
    fake.vectors.set(query, vector)
    const readers = { ...w.readers('s1', 'main'), semantic: await embeddings.semantic(query, []) }
    const ranking = rankForTools(readers, { paths: [], query, mutation: false, limit: 8 })
    assert.deepEqual(ranking.candidates.map(c => c.memory.id), [close.id])
    assert.match(ranking.rejected.find(r => r.id === loose.id)?.reason ?? '', /relation 0\.71 is below 0\.85/)
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
