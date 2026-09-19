import { describe, expect, test, tier } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf } from 'claude-code'
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

/** A models.list answer: two text models, and a speech and an image model the list leaves out. */
const MODELS = JSON.stringify({
  models: [
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'], thinking: true, inputTokenLimit: 1_048_576 },
    { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedGenerationMethods: ['generateContent'], thinking: true, inputTokenLimit: 1_048_576 },
    { name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'], thinking: true, inputTokenLimit: 8192 },
    { name: 'models/gemini-3-pro-image', supportedGenerationMethods: ['generateContent'], thinking: true, inputTokenLimit: 131_072 },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'], inputTokenLimit: 2048 },
  ],
})

type World = { fetches: { url: string; key: string | undefined }[]; replies: { status: number; text: string }[]; panes: string[]; toasts: string[] }

// Beneath the plugin: the same store, the environment, Google's model list,
// the pane calls, and `$.gemini` answered by the provider above.
function world(on: On, p: ReturnType<typeof provider>, key?: string): World {
  const w: World = { fetches: [], replies: [], panes: [], toasts: [] }
  on('env.get', (_, e) => ({ value: e.name === 'GEMINI_API_KEY' ? key : undefined }))
  on('store.get', (_, e) => ({ value: p.store.get(e.key) }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('gemini.settings', async (_, e) => ({ value: await p.gemini.settings(e) }))
  on('gemini.configure', async (_, e) => ({ value: await p.gemini.configure(e) }))
  on('http.fetch', (_, e) => {
    w.fetches.push({ url: e.url, key: e.init?.headers?.['x-goog-api-key'] })
    const reply = w.replies.shift() ?? { status: 200, text: MODELS }
    return { value: { status: reply.status, ok: reply.status < 300, headers: {}, text: reply.text } }
  })
  on('ui.open', (_, e) => { w.panes.push(`open ${e.id} ${e.title ?? ''}`); return { value: undefined } })
  on('ui.close', (_, e) => { w.panes.push(`close ${e.id}`); return { value: undefined } })
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  return w
}

const PANE = { title: 'Gemini model', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['Pane']

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

  test('lists the text models the key gives, asking Google once until refresh', async ($, on) => {
    const p = provider({ key: 'KEY' })
    const w = world(on, p, 'KEY')
    expect((await $.command.run(run('models'))).text).toBe('gemini-3.5-flash-lite · thinking · 1M in\ngemini-3.8-flash · thinking · 1M in')
    await $.command.run(run('models'))
    expect(w.fetches).toEqual([{ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', key: 'KEY' }])
    await $.command.run(run('models refresh'))
    expect(w.fetches).toHaveLength(2)
  })

  test('takes a model id only when the list has it, and asks the next key when one fails', async ($, on) => {
    const p = provider({ key: 'K1, K2' })
    const w = world(on, p, 'K1, K2')
    await p.gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    w.replies.push({ status: 400, text: JSON.stringify({ error: { message: 'API key not valid.' } }) })
    expect((await $.command.run(run('model review gemini-3.8-flas'))).text).toBe('gemini-3.8-flas is not a Gemini text model this key lists; closest: gemini-3.8-flash, gemini-3.5-flash-lite. /gemini-core models lists them.')
    expect(w.fetches.map(f => f.key)).toEqual(['K1', 'K2'])
    expect((await $.command.run(run('model review gemini-3.5-flash-lite'))).text).toBe('gemini-review: model gemini-3.5-flash-lite')
    expect((await p.gemini.settings({ consumer: 'gemini-review' })).model).toBe('gemini-3.5-flash-lite')
  })

  test('without a model id opens a pane whose Select sets the pick and closes it', async ($, on) => {
    const p = provider({ key: 'KEY' })
    const w = world(on, p, 'KEY')
    await p.gemini.enroll({ consumer: 'gemini-review', defaultModel: 'gemini-3.8-flash' })
    expect((await $.command.run(run('model review'))).text).toBe('pick the model of gemini-review in the pane; Esc closes it')
    expect(w.panes).toEqual(['open gemini-core-model Gemini model for gemini-review'])
    const ui = await $.ui.mount({ plugin: 'gemini-core', surface: 'terminal', component: 'Pane', requestId: 'gemini-core-model', props: PANE })
    expect(await ui.find({ type: 'Select', key: 'model' })).toMatchObject({ props: { value: 'gemini-3.8-flash' } })
    await ui.select({ key: 'model', value: 'gemini-3.5-flash-lite' })
    expect((await p.gemini.settings({ consumer: 'gemini-review' })).model).toBe('gemini-3.5-flash-lite')
    expect(w.panes.at(-1)).toBe('close gemini-core-model')
    expect(w.toasts).toEqual(['gemini-review: model gemini-3.5-flash-lite'])
    expect((await $.command.run(run('model advisor'))).text).toBe('no Gemini mod named advisor; enrolled: gemini-review')
  })
})
