import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { EVERY_POLICY, heldTerms, searchStore, visibilityParams, type Visibility } from '../search.ts'
import { wordEvidence } from '../words.ts'
import { cleanUp } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const SHOWN: Visibility = { statuses: ['active'], policies: EVERY_POLICY, audienceScoped: true }

/** The memories the prompt's words single out, as their texts. */
function singledOut(w: World, texts: ReadonlyMap<string, string>, query: string): string[] {
  return [...wordEvidence(w.project.db, query, SHOWN).keys()].map(id => texts.get(id)!).sort()
}

async function store(texts: readonly string[]): Promise<{ w: World; texts: Map<string, string> }> {
  const w = world()
  const byId = new Map<string, string>()
  for (const text of texts) byId.set((await w.remember({ text, distinct: true })).memory.id, text)
  return { w, texts: byId }
}

const ENGLISH = [
  'The connection pool keeps twenty sockets for each worker',
  'Refunds above 500 euros need a second approval from finance',
  'The staging deploy banner shows on every preview page',
  'Images get immutable cache headers from the CDN',
  'The search index is rebuilt every Sunday night',
  'Access tokens live fifteen minutes after sign-in',
  'Log files are kept for ninety days, then deleted',
  'The Android app supports version ten and later',
  'Mail templates fall back to English when a language is missing',
  'The disk alert fires at eighty percent usage',
]

describe('word evidence from the store', () => {
  test('two rare words a memory holds single it out; words no memory holds do not', async () => {
    const { w, texts } = await store(ENGLISH)
    assert.deepEqual(singledOut(w, texts, 'who approves big refunds in finance'), [ENGLISH[1]])
    assert.deepEqual(singledOut(w, texts, 'check it again'), [])
    w.close()
  })

  test('one shared word is never enough, and two forms of one word count once', async () => {
    const { w, texts } = await store(ENGLISH)
    assert.deepEqual(singledOut(w, texts, 'refunds'), [], 'one word: df x k is at least 1')
    assert.deepEqual(singledOut(w, texts, 'stop!'), [])
    assert.deepEqual(singledOut(w, texts, 'refund refunds'), [], '`refund` stands for `refunds` too, so this is one word')
    w.close()
  })

  test('a store of one memory gives no word evidence: nothing in it is rare', async () => {
    const { w, texts } = await store([ENGLISH[1]!])
    assert.deepEqual(singledOut(w, texts, 'big refunds need finance approval'), [])
    w.close()
  })

  test('the words of an identifier and a suffixed word find the memory that holds them', async () => {
    const limit = 'RETRY_LIMIT value must not be changed without consulting the ops team first.'
    const { w, texts } = await store([...ENGLISH, limit])
    assert.deepEqual(singledOut(w, texts, 'retry limit kaç'), [limit], 'the index splits the identifier at the underscore')
    assert.deepEqual(singledOut(w, texts, 'retry limiti kaç'), [limit], 'a suffixed word is cut to the longest prefix the store holds')
    w.close()
  })

  test('a camelCase identifier, a Japanese word and a name beside Japanese text are found', async () => {
    const camel = 'Call retryLimit before each send'
    const japanese = 'アプリケーションのログは90日間保存した後、削除します。'
    const named = 'Android アプリの minSdkは29です。'
    const { w, texts } = await store([...ENGLISH, camel, japanese, named])
    assert.deepEqual(singledOut(w, texts, 'retry limit before send'), [camel], 'the index holds the words of the identifier')
    assert.deepEqual(singledOut(w, texts, 'ログは何日間保存しますか'), [japanese])
    assert.deepEqual(singledOut(w, texts, 'minSdk 29'), [named])
    w.close()
  })

  test('the prompt terms of a Japanese question count in the units the memory is weighed in', async () => {
    // The rule picks `held` of the prompt's k known terms. When the pairs of one word count as one
    // term for the memory, k counts that word once as well: the nine pairs of two words made k 11
    // and C(11, 2) 55, so two words only this memory holds did not single it out.
    const disk = 'サーバーのディスク使用率が85パーセントを超えるとアラートが出ます。'
    const others = ['ログは90日間保存されます。', '検索インデックスは毎週日曜日に再構築されます。', '返金には承認が必要です。', 'トークンは15分で切れます。']
    const { w, texts } = await store([...ENGLISH, disk, ...others])
    assert.deepEqual(singledOut(w, texts, 'ディスク使用率のアラートはいつですか'), [disk])
    assert.deepEqual(singledOut(w, texts, 'ディスクはいつですか'), [], 'one word the memory holds is still never enough')
    w.close()
  })

  test('a search finds a memory through the stem of a suffixed word', async () => {
    const { w, texts } = await store(ENGLISH)
    const found = searchStore(w.project.db, 'logların süresi', SHOWN, 10).map(memory => texts.get(memory.id))
    assert.deepEqual(found, [ENGLISH[6]], '`logların` is cut to `log`, which `Log files` holds')
    w.close()
  })

  test('the question at the end of a long pasted log keeps its words', async () => {
    const { w, texts } = await store(ENGLISH)
    const log = Array.from({ length: 80 }, (_, i) => `2026-11-16T10:${String(i % 60).padStart(2, '0')}:00Z worker-${i % 4} processed batch ${i * 17} in ${100 + i}ms`).join('\n')
    const prompt = `${log}\nWho approves big refunds in finance?`
    assert.deepEqual(singledOut(w, texts, prompt), [ENGLISH[1]], 'the log terms no memory holds take none of the 64 places')
    assert.equal(texts.get(searchStore(w.project.db, prompt, SHOWN, 10)[0]!.id), ENGLISH[1], 'the search ranks the memory of the question first')
    w.close()
  })

  test('a term with a digit is an identifier or a number, never cut to a shorter word', async () => {
    const { w } = await store([...ENGLISH, 'The abc team owns the nightly build'])
    const params = visibilityParams(SHOWN)
    assert.deepEqual(heldTerms(w.project.db, 'abc9f3e1', params).terms, [], 'a hash that starts like a word does not become that word')
    assert.deepEqual(heldTerms(w.project.db, 'logların', params).terms.map(term => term.term), ['"log"*'], 'a word of letters is still cut to its stem')
    w.close()
  })

  test('a query matches with at most 64 held terms, the rarest first', async () => {
    // The `z` ends each word, so no word is the prefix of another (`w1z` does not start `w10z`).
    const many = Array.from({ length: 100 }, (_, i) => `w${i}z`)
    const quarters = [0, 25, 50, 75].map(from => many.slice(from, from + 25).join(' '))
    // w70z to w99z are held by a second memory too; w0z to w69z by one memory each.
    const { w } = await store([...quarters, many.slice(70, 85).join(' '), many.slice(85, 100).join(' ')])
    const held = heldTerms(w.project.db, many.join(' '), visibilityParams(SHOWN))
    assert.equal(held.terms.length, 64)
    assert.ok(held.terms.every(term => term.count === 1), 'the 70 terms only one memory holds come before the 30 two memories hold')
    w.close()
  })

  test('words common in the store single nothing out in a language the store is written in', async () => {
    const turkish = [
      'Büyük bir iade için finans ekibinden ikinci bir onay gerekir',
      'Bağlantı havuzu her işçi için yirmi soket tutar',
      'Hazırlık ortamı için bir afiş her önizleme sayfasında görünür',
      'Arama dizini her pazar gecesi baştan kurulur',
      'Erişim token’ı girişten sonra on beş dakika geçerlidir',
      'Log dosyaları doksan gün tutulur, sonra silinir',
      'Bu uygulama Android on ve sonrası için yayınlanır',
      'Disk uyarısı yüzde sekseninde bir bildirim gönderir',
    ]
    const { w, texts } = await store(turkish)
    assert.deepEqual(singledOut(w, texts, 'bunun için bir şey yap'), [])
    w.close()
  })

  test('a memory a reminder may not see is not counted and not singled out', async () => {
    const { w, texts } = await store(ENGLISH)
    await w.remember({ text: 'Refunds in finance are approved twice for big amounts', audience: { roles: ['explore'] } })
    const hidden: Visibility = { ...SHOWN, audienceScoped: false }
    assert.deepEqual([...wordEvidence(w.project.db,'who approves big refunds in finance', hidden).keys()].map(id => texts.get(id)), [ENGLISH[1]])
    w.close()
  })
})
