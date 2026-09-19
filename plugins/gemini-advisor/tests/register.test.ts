import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, SessionMessage, ToolSpec } from 'claude-code'

import { SYSTEM_GUIDANCE, TOOL_ID } from '../hooks/advice.ts'

tier('user')

const TOOL = TOOL_ID

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Fix the flaky test.', toolUses: [] },
  { role: 'assistant', text: 'Running it.', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'npm test' } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'FAIL timeout after 5000 ms', isError: true }] },
]

const run = (args: string): CommandRunInput => ({
  command: 'gemini-advisor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const reply = (text: string, finishReason = 'STOP') =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 40 } })

/** gemini-core as an inline plugin: it adds `$.gemini`, whose calls the hooks of `seatCore` answer. */
const CORE: Plugin = {
  name: 'gemini-core',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), gemini: { enroll: stub, settings: stub, request: stub, read: stub, configure: stub } }))
  },
}

/** gemini-core's /gemini-core, which calls `$.gemini.configure`; the args are the change as JSON. */
const CORE_COMMAND: Plugin = {
  name: 'gemini-core-command',
  register(on) {
    on('command.run', { command: 'gemini-core' }, async ($, e) => ({ text: await $.gemini.configure(JSON.parse(String(e.args))) }))
  },
}

/** A test with gemini-core loaded beside the plugin. */
const it = (name: string, body: TestBody) => test(name, { plugins: [CORE, CORE_COMMAND] }, body)

const coreRun = (change: object): CommandRunInput => ({ ...run(JSON.stringify(change)), command: 'gemini-core' })

/** What gemini-core holds for this mod; `/gemini-core` changes reach it through `gemini.configure`. */
type Core = { key?: string; tier: 'free' | 'paid'; model: string }

/** gemini-core's reading of a response, as far as these tests need it (gemini-core's tests cover the rest). */
function coreRead(e: { status: number; ok: boolean; text: string; attempt: number }) {
  const delay = [1000, 2000, 3000][e.attempt - 1]
  if (e.status === 503 && delay !== undefined) return { retryInMs: delay }
  const value = JSON.parse(e.text)
  if (!e.ok) return { error: `Gemini HTTP ${e.status}: ${value.error.message}` }
  const c = value.candidates[0]
  return { answer: { text: c.content.parts[0].text, inputTokens: value.usageMetadata.promptTokenCount, outputTokens: value.usageMetadata.candidatesTokenCount, finishReason: c.finishReason } }
}

function seatCore(on: On, core: Core): void {
  on('gemini.enroll', () => ({ value: undefined }))
  on('gemini.settings', () => ({ value: { hasKey: core.key !== undefined, tier: core.tier, model: core.model } }))
  on('gemini.request', (_, e) => {
    if (core.key === undefined) return { value: { error: 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option' } }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${core.model}:generateContent`
    return { value: { http: { url, init: { method: 'POST' as const, headers: { 'x-goog-api-key': core.key }, body: JSON.stringify(e.body) } }, model: core.model, tier: core.tier } }
  })
  on('gemini.read', (_, e) => ({ value: coreRead(e) }))
  on('gemini.configure', (_, e) => {
    if ('model' in e) core.model = e.model
    if ('tier' in e) core.tier = e.tier
    return { value: 'changed' }
  })
}

type World = {
  clock: MockClock
  core: Core
  store: Map<string, unknown>
  requests: { url: string; body: string; key: string | undefined }[]
  replies: { status: number; text: string }[]
  tools: ToolSpec[]
  toasts: string[]
  reads: number
}

// Beneath the plugin: gemini-core, a store, a transcript, Gemini answering from a script.
function world(on: On, opts: { key?: string; store?: [string, unknown][] } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    core: { ...(opts.key === undefined ? {} : { key: opts.key }), tier: 'free', model: 'gemini-3.8-flash' },
    store: new Map(opts.store ?? []),
    requests: [],
    replies: [],
    tools: [],
    toasts: [],
    reads: 0,
  }
  seatCore(on, w.core)
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('session.messages', () => { w.reads++; return { value: MESSAGES } })
  on('http.fetch', (_, e) => {
    w.requests.push({ url: e.url, body: String(e.init?.body ?? ''), key: e.init?.headers?.['x-goog-api-key'] })
    const r = w.replies.shift() ?? { status: 500, text: '{}' }
    return { value: { status: r.status, ok: r.status < 300, headers: {}, text: r.text } }
  })
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('tool.register', (_, e) => { w.tools.push(e); return { value: { tool: `mcp__gemini-advisor__${e.name}` } } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return w
}

const start = { surface: null, isInteractive: false, cwd: '/src/app' } as const

describe('gemini-advisor', () => {
  it('declares the advise tool and when to call it, without a model name that a change would leave stale', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start(start)
    expect(w.tools).toHaveLength(1)
    expect(w.tools[0]?.name).toBe('advise')
    expect(w.tools[0]?.description).toContain('Ask Gemini, a second model, for advice.')
    expect(w.tools[0]?.description).not.toContain('gemini-3')
    expect(w.tools[0]?.description).toContain('before you tell the user the work is done')
    expect(w.tools[0]?.inputSchema).toMatchObject({ required: ['message'] })
  })

  it('tells the model in the system prompt when to call the tool and how to load it', async ($, on) => {
    world(on)
    on('prompt.section', (_, e) => ({ text: e.text }))
    const r = await $.prompt.section({ name: 'env_info_simple', text: 'Working directory: /src' })
    expect(r.text).toBe(`Working directory: /src\n\n${SYSTEM_GUIDANCE}`)
    expect(SYSTEM_GUIDANCE).toContain('select:mcp__gemini-advisor__advise')
    expect(SYSTEM_GUIDANCE).toContain('when you choose between two approaches')
    expect((await $.prompt.section({ name: 'memory', text: 'm' })).text).toBe('m')
    expect((await $.prompt.section({ name: 'env_info_simple', text: null })).text).toBe(null)
  })

  it('sends the conversation and the message, and answers with the advice', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply('Raise the timeout only after you find what is slow.') })
    const r = await $.tool.call({ tool: TOOL, message: 'I will raise the timeout to 10 s. Good idea?' })
    expect(r.result).toBe('Raise the timeout only after you find what is slow.')
    expect(w.requests[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(w.requests[0]?.key).toBe('KEY')
    const text = JSON.parse(w.requests[0]?.body ?? '{}').contents[0].parts[0].text as string
    expect(text).toContain('#1 user: Fix the flaky test.')
    expect(text).toContain('  [call] Bash {"command":"npm test"}\n  error: FAIL timeout after 5000 ms')
    expect(text.endsWith('The agent asks:\n\nI will raise the timeout to 10 s. Good idea?')).toBe(true)
    expect(w.toasts).toEqual(['asked gemini-3.8-flash · 3 messages · 2k in, 40 out · sent to Gemini free tier'])
  })

  it('a subagent\'s call sends only its message', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply('Looks right.') })
    await $.tool.call({ tool: TOOL, message: 'Is this right?', agentId: 'a1' })
    expect(w.reads).toBe(0)
    expect(w.requests[0]?.body).toContain('The conversation is not available')
    expect(w.toasts[0]).toContain('· message only ·')
  })

  it('tells the model why when it is off or has no key, and asks nothing', async ($, on) => {
    const w = world(on, { store: [['enabled', false]] })
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toContain('gemini-advisor is off')
    w.store.delete('enabled')
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toBe('Gemini advisor failed: no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option')
    expect(w.requests).toEqual([])
  })

  it('turns a Gemini error, a cut advice and a missing message into a denial the model reads', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) })
    w.replies.push({ status: 200, text: reply('Half an ans', 'MAX_TOKENS') })
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toBe('Gemini advisor failed: Gemini HTTP 429: Resource has been exhausted')
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toContain('output token limit')
    expect((await $.tool.call({ tool: TOOL, message: '  ' })).deny).toContain('message is required')
    expect(w.requests).toHaveLength(2)
  })

  it('asks again after a 503, and gives up after the fourth attempt', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    const busy = { status: 503, text: JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }) }
    w.replies.push(busy, { status: 200, text: reply('Fine.') })
    const first = $.tool.call({ tool: TOOL, message: 'x' })
    await w.clock.advance(1000)
    expect((await first).result).toBe('Fine.')
    expect(w.requests).toHaveLength(2)
    w.replies.push(busy, busy, busy, busy)
    const second = $.tool.call({ tool: TOOL, message: 'x' })
    for (const ms of [1000, 2000, 3000]) await w.clock.advance(ms)
    expect((await second).deny).toContain('Gemini HTTP 503: This model is currently experiencing high demand.')
    expect(w.requests).toHaveLength(6)
  })

  it('asks the model /gemini-core moves it to, and says paid without the free warning', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start(start)
    await $.command.run(coreRun({ tier: 'paid' }))
    await $.command.run(coreRun({ consumer: 'advisor', model: 'gemini-3.7-flash' }))
    w.replies.push({ status: 200, text: reply('ok') })
    await $.tool.call({ tool: TOOL, message: 'x' })
    expect(w.tools).toHaveLength(1)
    expect(w.requests[0]?.url).toContain('/models/gemini-3.7-flash:generateContent')
    expect(w.toasts).toEqual(['asked gemini-3.7-flash · 3 messages · 2k in, 40 out'])
  })

  it('the command turns the advisor on and off and shows what gemini-core holds', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply('ok') })
    await $.tool.call({ tool: TOOL, message: 'x' })
    expect((await $.command.run(run(''))).text).toBe('on · gemini-3.8-flash · thinking model default · free tier · key set\nlast: asked gemini-3.8-flash · 3 messages · 2k in, 40 out')
    expect((await $.command.run(run('off'))).text).toBe('off: the model is told the advisor is off when it calls it')
    expect((await $.command.run(run('reset'))).text).toBe('on: back to the default')
    expect([...w.store.keys()]).toEqual([])
    expect((await $.command.run(run('model gemini-3.7-flash'))).text).toBe('expects on, off, or reset; /gemini-core sets the model, the thinking level and the tier')
  })
})
