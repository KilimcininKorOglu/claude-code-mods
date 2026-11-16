import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { EVERY_POLICY, type Visibility } from '../search.ts'
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
