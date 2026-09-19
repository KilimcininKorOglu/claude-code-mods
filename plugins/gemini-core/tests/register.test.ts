import { describe, expect, test, tier } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'
import type { Gemini } from '../types/index.d.ts'

import { configFrom, createGemini, type Host } from '../hooks/register.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'gemini-core', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const BODY = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 100 } }

// The test engine runs no engine.create, so `$.gemini` is built here on a store in memory.
function provider(opts: { key?: string; options?: Record<string, string> } = {}): { gemini: Gemini; store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  const host: Host = {
    get: async key => store.get(key),
    set: async (key, value) => { store.set(key, value) },
    del: async key => { store.delete(key) },
    envKey: async () => opts.key,
  }
  return { gemini: createGemini(host, configFrom(opts.options ?? {})), store }
}

// Beneath the plugin: the same store, the environment, and `$.gemini` answered by the provider above.
function world(on: On, p: ReturnType<typeof provider>, key?: string): void {
  on('env.get', (_, e) => ({ value: e.name === 'GEMINI_API_KEY' ? key : undefined }))
  on('store.get', (_, e) => ({ value: p.store.get(e.key) }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('gemini.settings', async (_, e) => ({ value: await p.gemini.settings(e) }))
  on('gemini.configure', async (_, e) => ({ value: await p.gemini.configure(e) }))
}

describe('$.gemini', () => {
  test('builds an enrolled mod\'s request with its default model and no thinking level', async () => {
    const { gemini } = provider({ key: 'KEY' })
    await gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    const r = await gemini.request({ consumer: 'gemini-review', body: BODY })
    if ('error' in r) throw new Error(r.error)
    expect(r.model).toBe('gemini-3.8-flash')
    expect(r.tier).toBe('free')
    expect(r.http.url).toContain('/models/gemini-3.8-flash:generateContent')
    expect(r.http.init.headers['x-goog-api-key']).toBe('KEY')
    expect(JSON.parse(r.http.init.body)).toEqual(BODY)
  })

  test('a mod\'s model and thinking level reach only its request; the tier reaches all', async () => {
    const { gemini } = provider({ key: 'KEY' })
    await gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    await gemini.enroll({ consumer: 'gemini-compact', defaultModel: 'gemini-3.5-flash-lite' })
    expect(await gemini.configure({ consumer: 'review', thinking: 'low' })).toBe('gemini-review: thinking low')
    expect(await gemini.configure({ consumer: 'review', model: 'gemini-3.7-flash' })).toBe('gemini-review: model gemini-3.7-flash')
    expect(await gemini.configure({ tier: 'paid' })).toBe('paid tier')
    const r = await gemini.request({ consumer: 'gemini-review', body: BODY })
    if ('error' in r) throw new Error(r.error)
    expect([r.model, r.tier]).toEqual(['gemini-3.7-flash', 'paid'])
    expect(JSON.parse(r.http.init.body).generationConfig).toEqual({ maxOutputTokens: 100, thinkingConfig: { thinkingLevel: 'low' } })
    expect(await gemini.settings({ consumer: 'gemini-compact' })).toEqual({ hasKey: true, keys: 1, tier: 'paid', model: 'gemini-3.5-flash-lite' })
  })

  test('default and reset bring the model\'s own thinking and the default model back', async () => {
    const { gemini, store } = provider({ key: 'KEY' })
    await gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    await gemini.configure({ consumer: 'review', thinking: 'high' })
    expect(await gemini.configure({ consumer: 'gemini-review', thinking: null })).toBe('gemini-review: thinking model default')
    expect((await gemini.settings({ consumer: 'gemini-review' })).thinking).toBe(undefined)
    await gemini.configure({ consumer: 'review', model: 'gemini-3.7-flash' })
    await gemini.configure({ tier: 'paid' })
    await gemini.configure({ reset: true })
    expect(await gemini.settings({ consumer: 'gemini-review' })).toEqual({ hasKey: true, keys: 1, tier: 'free', model: 'gemini-3.8-flash' })
    expect([...store.keys()]).toEqual(['consumers'])
  })

  test('the plugin options give the key and the tier', async () => {
    const { gemini } = provider({ options: { apiKey: ' OPT ', tier: 'paid' } })
    await gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    const r = await gemini.request({ consumer: 'gemini-review', body: BODY })
    if ('error' in r) throw new Error(r.error)
    expect([r.http.init.headers['x-goog-api-key'], r.tier]).toEqual(['OPT', 'paid'])
  })

  test('the option\'s keys win over the environment; after a quota the next request starts at the key that moved on', async () => {
    const { gemini } = provider({ key: 'ENV', options: { apiKey: 'K1, K2' } })
    await gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    expect((await gemini.settings({ consumer: 'gemini-review' })).keys).toBe(2)
    const first = await gemini.request({ consumer: 'gemini-review', body: BODY })
    if ('error' in first) throw new Error(first.error)
    expect(first.http.init.headers['x-goog-api-key']).toBe('K1')
    const quota = JSON.stringify({ error: { message: 'quota' } })
    const read = await gemini.read({ http: first.http, status: 429, ok: false, text: quota, attempt: 1, elapsedMs: 0 })
    expect('next' in read && read.next.init.headers['x-goog-api-key']).toBe('K2')
    const second = await gemini.request({ consumer: 'gemini-review', body: BODY })
    if ('error' in second) throw new Error(second.error)
    expect(second.http.init.headers['x-goog-api-key']).toBe('K2')
    const fromEnv = provider({ key: 'E1, E2' }).gemini
    await fromEnv.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    expect((await fromEnv.settings({ consumer: 'gemini-review' })).keys).toBe(2)
  })

  test('says why there is no request, and refuses a bad enrollment or change', async () => {
    const { gemini } = provider()
    await gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    expect(await gemini.request({ consumer: 'gemini-review', body: BODY })).toEqual({ error: 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option' })
    const keyed = provider({ key: 'KEY' }).gemini
    expect(await keyed.request({ consumer: 'gemini-advisor', body: BODY })).toEqual({ error: 'gemini-advisor has not enrolled with gemini-core' })
    await expect(keyed.enroll({ consumer: 'Bad Name', defaultModel: 'gemini-3.8-flash' })).rejects.toThrow('enroll takes a plugin name')
    await expect(keyed.configure({ consumer: 'advisor', thinking: 'low' })).rejects.toThrow('no Gemini mod named advisor; enrolled: none')
  })
})

describe('/gemini-core', () => {
  test('changes a setting and shows each enrolled mod', async ($, on) => {
    const p = provider({ key: 'KEY' })
    world(on, p, 'KEY')
    await $.session.start({ surface: null, isInteractive: false, cwd: '/src' })
    await p.gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    await p.gemini.enroll({ consumer: 'gemini-compact', defaultModel: 'gemini-3.5-flash-lite' })
    expect((await $.command.run(run('thinking review low'))).text).toBe('gemini-review: thinking low')
    expect((await $.command.run(run('paid'))).text).toBe('paid tier')
    expect((await $.command.run(run(''))).text).toBe('paid tier · key set\ngemini-compact: gemini-3.5-flash-lite · thinking model default\ngemini-review: gemini-3.8-flash · thinking low')
    expect((await $.command.run(run('thinking advisor low'))).text).toContain('no Gemini mod named advisor')
    expect((await $.command.run(run('thinking review max'))).text).toBe('thinking level max is not one of minimal, low, medium, high, default')
  })
})
