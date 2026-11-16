import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { namesOf } from '../names.ts'
import { rankForPrompt } from '../remind.ts'
import { cleanUp } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

/** The memory ids a prompt reminder may carry without embeddings, for a block of eight. */
function sentFor(w: World, query: string): string[] {
  return rankForPrompt(w.readers('s1', 'main'), { query, limit: 24, blockCount: 8 }).candidates.map(c => c.memory.id)
}

describe('names a prompt holds', () => {
  test('an identifier, a file name, a version and a hyphenated word are names; plain words of any language are not', () => {
    assert.deepEqual(namesOf('Where is TOKEN_TTL_SECONDS set? Why is minSdk 29? What does reindex.ts do?'), ['token_ttl_seconds', 'minsdk', 'reindex.ts'])
    assert.deepEqual(namesOf('stop! bunun için bir şey yap, check it again'), [])
    assert.deepEqual(namesOf('bana bir e-posta yaz, opt-in gerekli mi, HTTP 500 hatası'), ['e-posta', 'opt-in', '500'])
  })

  test('a name ends at a Turkish suffix after an apostrophe, at Japanese text, at a sentence end and at a parenthesis', () => {
    assert.deepEqual(namesOf("CACHE_TTL'i nerede? reindex.ts’i aç"), ['cache_ttl', 'reindex.ts'])
    assert.deepEqual(namesOf('minSdkはなぜ29ですか'), ['minsdk'])
    assert.deepEqual(namesOf('It is set in config.ts. See (harbor-api).'), ['config.ts', 'harbor-api'])
  })
})

describe('a prompt reminder for a named memory', () => {
  test('a memory whose text holds a name the prompt gives goes, with default importance, no anchor and no embeddings', async () => {
    const w = world()
    const ttl = (await w.remember({ text: 'Access tokens live 15 minutes; `TOKEN_TTL_SECONDS` in the auth config sets it.' })).memory
    const sdk = (await w.remember({ text: 'The Android app supports Android 10 and later; `minSdk` is 29.' })).memory
    await w.remember({ text: 'Refresh tokens live 30 days and are rotated on every use.' })
    assert.deepEqual(sentFor(w, 'Where is TOKEN_TTL_SECONDS set?'), [ttl.id])
    assert.deepEqual(sentFor(w, 'Why is minSdk 29?'), [sdk.id])
    assert.deepEqual(sentFor(w, "TOKEN_TTL_SECONDS'i kim değiştirdi?"), [ttl.id], 'a Turkish suffix after the name')
    w.close()
  })

  test('a name the text holds only inside a longer token or only as a tag names nothing', async () => {
    const w = world()
    const own = (await w.remember({ text: 'The route cache lives in Redis; `CACHE_TTL` changes its lifetime.', tags: ['cache'] })).memory
    await w.remember({ text: 'Images get immutable cache headers from the CDN.', tags: ['cache'] })
    await w.remember({ text: 'The `CACHE_TTL_FALLBACK` value applies when Redis is down.', tags: ['cache'] })
    assert.deepEqual(sentFor(w, 'What does CACHE_TTL control?'), [own.id])
    w.close()
  })

  test("a file named by its name alone names the memories anchored to it, also under two paths, and a part of the name names nothing", async () => {
    const w = world()
    const reindex = (await w.remember({ text: 'The search index is rebuilt every Sunday; one tenant can be rebuilt on demand.', anchors: [{ type: 'file', path: 'src/search/reindex.ts' }] })).memory
    const auth = (await w.remember({ text: 'Access tokens live 15 minutes.', anchors: [{ type: 'file', path: 'src/auth/config.ts' }] })).memory
    const app = (await w.remember({ text: 'Mobile builds are signed in CI.', anchors: [{ type: 'file', path: 'app/config.ts' }] })).memory
    assert.deepEqual(sentFor(w, 'What does reindex.ts do?'), [reindex.id])
    assert.deepEqual(sentFor(w, 'What is set in config.ts?').sort(), [auth.id, app.id].sort())
    const part = rankForPrompt(w.readers('s1', 'main'), { query: 'What does the index do?', limit: 24, blockCount: 8 })
    assert.ok(part.candidates.every(c => !c.reasons.some(reason => reason.startsWith('query:exact-name:'))), 'a part of a file name names no memory')
    w.close()
  })

  test('a name more memories hold than the block carries singles none out', async () => {
    const w = world()
    for (let i = 0; i < 9; i++) await w.remember({ text: `Fact ${i + 1} about the staging host of harbor-api: rule ${'abcdefghi'[i]} holds there.`, distinct: true })
    assert.deepEqual(sentFor(w, 'What does harbor-api do on staging?'), [])
    w.close()
  })

  test('a named memory goes although the word search would not rank it among the hits', async () => {
    const w = world()
    for (let i = 0; i < 30; i++) await w.remember({ text: `Staging deploy step ${i + 1} posts its progress to the deploy channel and the staging log.`, distinct: true })
    const named = (await w.remember({ text: 'The `DEPLOY_LOCK_TTL` value keeps a second deploy waiting.' })).memory
    const ranking = rankForPrompt(w.readers('s1', 'main'), { query: 'staging deploy channel log progress DEPLOY_LOCK_TTL', limit: 4, blockCount: 8 })
    assert.equal(ranking.candidates[0]?.memory.id, named.id)
    w.close()
  })

  test('a named memory still needs the importance floor', async () => {
    const w = world()
    await w.remember({ text: 'The `LEGACY_PORT` value is 8081.', importance: 0.3 })
    assert.deepEqual(sentFor(w, 'What is LEGACY_PORT?'), [])
    w.close()
  })
})
