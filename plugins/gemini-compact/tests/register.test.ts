import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, SessionMessage, TurnCompleteInput } from 'claude-code'

tier('user')

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

/** What gemini-core holds for this mod; `/gemini-core` changes reach it through `gemini.configure`. */
type Core = { key?: string; tier: 'free' | 'paid'; model: string; enrolled: string[] }

/** gemini-core's reading of a response, as far as these tests need it (gemini-core's tests cover the rest). */
function coreRead(e: { status: number; ok: boolean; text: string; attempt: number }) {
  const delay = [1000, 2000, 3000][e.attempt - 1]
  if (e.status === 503 && delay !== undefined) return { retryInMs: delay }
  const value = JSON.parse(e.text)
  if (!e.ok) return { error: `Gemini HTTP ${e.status}: ${value.error.message}` }
  const c = value.candidates[0]
  const answer = { text: c.content.parts[0].text, inputTokens: value.usageMetadata.promptTokenCount, outputTokens: value.usageMetadata.candidatesTokenCount }
  return { answer: c.finishReason === undefined ? answer : { ...answer, finishReason: c.finishReason } }
}

function seatCore(on: On, core: Core): void {
  on('gemini.enroll', (_, e) => { core.enrolled.push(`${e.consumer} ${e.defaultModel}`); return { value: undefined } })
  on('gemini.settings', () => ({ value: { hasKey: core.key !== undefined, keys: core.key === undefined ? 0 : 1, tier: core.tier, model: core.model } }))
  on('gemini.request', (_, e) => {
    if (core.key === undefined) return { value: { error: 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option' } }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${core.model}:generateContent`
    return { value: { http: { url, init: { method: 'POST' as const, headers: { 'x-goog-api-key': core.key }, body: JSON.stringify(e.body) } }, model: core.model, tier: core.tier } }
  })
  // With the key KEY1, gemini-core holds a second key, KEY2, that a 429 moves to.
  on('gemini.read', (_, e) => ({ value: e.status === 429 && e.http.init.headers['x-goog-api-key'] === 'KEY1' ? { next: { ...e.http, init: { ...e.http.init, headers: { ...e.http.init.headers, 'x-goog-api-key': 'KEY2' } } } } : coreRead(e) }))
  on('gemini.configure', (_, e) => {
    if ('model' in e) core.model = e.model
    if ('tier' in e) core.tier = e.tier
    return { value: 'changed' }
  })
}

const coreRun = (change: object): CommandRunInput => ({ ...run(JSON.stringify(change)), command: 'gemini-core' })

const BIG = 'x'.repeat(5000)

const TAIL = ['Fixed.', 'Thanks.', 'Welcome.', 'One more.', 'Sure.', 'Bye.']

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Fix the bug.', toolUses: [], handle: 'h0' },
  { role: 'assistant', text: 'Reading.', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'cat big.log' }, text: BIG }], handle: 'h1' },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: BIG, isError: false }], handle: 'h2' },
  // Six newest messages: the plugin keeps them whole.
  ...TAIL.map(
    (text, i): SessionMessage => ({ role: i % 2 === 0 ? 'assistant' : 'user', text, toolUses: [], handle: `h${i + 3}` }),
  ),
]

const run = (args: string): CommandRunInput => ({
  command: 'gemini-compact', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const SUMMARY: SessionMessage[] = [{ role: 'user', text: 'SUMMARY', toolUses: [] }]

const answer = (decisions: unknown) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ decisions }) }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 20 } })

const turn = (over: Partial<TurnCompleteInput> = {}): TurnCompleteInput =>
  ({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer', ...over }) as TurnCompleteInput

type World = {
  clock: MockClock
  core: Core
  store: Map<string, unknown>
  requests: { url: string; body: string; key: string | undefined }[]
  replies: { status: number; text: string }[]
  logs: string[]
  toasts: string[]
  builtIn: string[]
  percent: number
}

const SUMMARY_TEXT = 'The user asked to fix the bug. The assistant read big.log with cat and found the failing line. '.repeat(3)

const summarized = (text: string, finishReason = 'STOP') =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 20 } })

// Beneath the plugin: gemini-core, a store, Gemini answering from a script,
// and the engine's own compaction, which answers with a one-message summary.
// The stored mode is prune unless a test names another; `mode: null` stores none.
function world(on: On, opts: { key?: string; store?: [string, unknown][]; mode?: string | null } = {}): World {
  const mode = opts.mode === undefined ? 'prune' : opts.mode
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    core: { ...(opts.key === undefined ? {} : { key: opts.key }), tier: 'free', model: 'gemini-3.5-flash-lite', enrolled: [] },
    store: new Map([...(mode === null ? [] : [['mode', mode] as [string, unknown]]), ...(opts.store ?? [])]),
    requests: [],
    replies: [],
    logs: [],
    toasts: [],
    builtIn: [],
    percent: 10,
  }
  seatCore(on, w.core)
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('http.fetch', (_, e) => {
    w.requests.push({ url: e.url, body: String(e.init?.body ?? ''), key: e.init?.headers?.['x-goog-api-key'] })
    const reply = w.replies.shift() ?? { status: 500, text: '{}' }
    return { value: { status: reply.status, ok: reply.status < 300, headers: {}, text: reply.text } }
  })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('session.compact', (_, e) => { w.builtIn.push(e.trigger); return { messages: SUMMARY } })
  on('session.usage', () => ({ value: { context: { window: 1_000_000, percent: w.percent }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return w
}

describe('gemini-compact', () => {
  it('replaces the summary with the conversation less what Gemini dropped', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: answer([{ id: 'c1', action: 'drop' }]) })
    const r = await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.builtIn).toEqual([])
    expect(r.messages?.map(m => m.text)).toEqual([
      'Fix the bug.',
      'Reading.\n\n[gemini-compact removed 1 earlier tool call(s) and their output after a compaction; they ran: Bash(cat big.log)]',
      ...TAIL,
    ])
    expect(r.messages?.[0]).toMatchObject({ handle: 'h0' })
    expect(w.requests[0]?.url).toContain('/models/gemini-3.5-flash-lite:generateContent')
    expect(w.requests[0]?.key).toBe('KEY')
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]).toMatch(/^kept 8\/9 messages · 9\d% smaller · 1 dropped, 0 truncated · 2k in, 20 out$/)
    expect(w.toasts[0]).toMatch(/ · sent to Gemini free tier$/)
  })

  it('falls back to the built-in summary when the decisions remove too little', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: answer([{ id: 'c1', action: 'keep' }]) })
    const r = await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    expect(r.messages).toEqual(SUMMARY)
    expect(w.builtIn).toEqual(['auto'])
    expect(w.logs[0]).toMatch(/^built-in summary: under 25% smaller \(kept 9\/9 messages · 0% smaller/)
  })

  it('falls back on a Gemini error, a bad answer and a missing key, and says why', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) })
    w.replies.push({ status: 200, text: answer([]) })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.builtIn).toEqual(['manual', 'manual'])
    expect(w.logs).toEqual(['built-in summary: Gemini HTTP 429: Resource has been exhausted', 'built-in summary: no decision for c1'])
  })

  it('without a key it asks nothing and uses the built-in summary', async ($, on) => {
    const w = world(on)
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.requests).toEqual([])
    expect(w.logs).toEqual(['built-in summary: no Gemini key (set GEMINI_API_KEY or the gemini-core apiKey option)'])
  })

  it('sends the same request with the next key at once after a 429', async ($, on) => {
    const w = world(on, { key: 'KEY1' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'quota' } }) }, { status: 200, text: answer([{ id: 'c1', action: 'drop' }]) })
    expect((await $.session.compact({ trigger: 'manual', messages: MESSAGES })).messages).toHaveLength(8)
    expect(w.requests.map(r => r.key)).toEqual(['KEY1', 'KEY2'])
    expect(w.requests[1]?.body).toBe(w.requests[0]?.body)
  })

  it('asks again after a 503, and falls back once gemini-core allows no more attempts', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    const busy = { status: 503, text: JSON.stringify({ error: { message: 'high demand' } }) }
    w.replies.push(busy, { status: 200, text: answer([{ id: 'c1', action: 'drop' }]) })
    const first = $.session.compact({ trigger: 'manual', messages: MESSAGES })
    await w.clock.advance(1000)
    expect((await first).messages).toHaveLength(8)
    w.replies.push(busy, busy, busy, busy)
    const second = $.session.compact({ trigger: 'manual', messages: MESSAGES })
    for (const ms of [1000, 2000, 3000]) await w.clock.advance(ms)
    await second
    expect(w.requests).toHaveLength(6)
    expect(w.builtIn).toEqual(['manual'])
    expect(w.logs[1]).toBe('built-in summary: Gemini HTTP 503: high demand')
  })

  it('leaves a subagent compaction and a compaction while off to the engine', async ($, on) => {
    const w = world(on, { key: 'KEY', store: [['enabled', false]] })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    w.store.delete('enabled')
    await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MESSAGES })
    expect(w.requests).toEqual([])
    expect(w.builtIn).toEqual(['manual', 'auto'])
  })

  it('enrolls with gemini-core, uses the model and tier it holds, and says paid without the free warning', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/src/app' })
    expect(w.core.enrolled).toEqual(['gemini-compact gemini-3.5-flash-lite'])
    await $.command.run(coreRun({ consumer: 'gemini-compact', model: 'gemini-3.5-flash' }))
    await $.command.run(coreRun({ tier: 'paid' }))
    w.replies.push({ status: 200, text: answer([{ id: 'c1', action: 'drop' }]) })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.requests[0]?.url).toContain('/models/gemini-3.5-flash:generateContent')
    expect(w.requests[0]?.key).toBe('KEY')
    expect(w.toasts[0]).not.toContain('free tier')
    const status = (await $.command.run(run(''))).text
    expect(status).toMatch(/^on · prune · gemini-3\.5-flash · thinking model default · automatic at 60% · paid tier · key set\nlast: kept 8\/9/)
    expect((await $.command.run(run('mode summary'))).text).toContain('mode summary')
    expect((await $.command.run(run('reset'))).text).toBe('settings reset to the plugin options')
    expect([...w.store.keys()]).toEqual([])
    expect((await $.command.run(run('at 150'))).text).toContain('1 to 99')
    expect((await $.command.run(run('paid'))).text).toContain('/gemini-core sets the model')
  })

  it('a finished turn over the threshold starts a compaction without holding the turn', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.percent = 59
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.builtIn).toEqual([])
    w.percent = 61
    await $.turn.complete(turn({ agentId: 'a1' }))
    await $.turn.complete(turn({ reason: 'error' } as Partial<TurnCompleteInput>))
    await w.clock.settle()
    expect(w.builtIn).toEqual([])
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.builtIn).toHaveLength(1)
  })

  it('does not compact again until the context was under the threshold', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.percent = 70
    await $.turn.complete(turn())
    await w.clock.settle()
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.builtIn).toHaveLength(1)
    w.percent = 20
    await $.turn.complete(turn())
    w.percent = 70
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.builtIn).toHaveLength(2)
  })

  it('by default Gemini summarizes the older part and the newest messages stay as the engine\'s own', async ($, on) => {
    const w = world(on, { key: 'KEY', mode: null })
    w.replies.push({ status: 200, text: summarized(SUMMARY_TEXT) })
    const r = await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    expect(w.builtIn).toEqual([])
    expect(r.messages).toHaveLength(7)
    expect(r.messages?.[0]).toMatchObject({ role: 'user', toolUses: [] })
    expect(r.messages?.[0]?.handle).toBe(undefined)
    expect(r.messages?.[0]?.text).toContain(SUMMARY_TEXT.trim())
    expect(r.messages?.slice(1)).toEqual(MESSAGES.slice(3))
    const body = JSON.parse(w.requests[0]?.body ?? '{}')
    expect(body.generationConfig.responseSchema).toBe(undefined)
    expect(body.contents[0].parts[0].text).toContain('[call] Bash {"command":"cat big.log"}')
    expect(body.contents[0].parts[0].text).not.toContain('Welcome.')
    expect(w.logs[0]).toMatch(/^summary: 9 → 7 messages · 9\d% smaller · 2k in, 20 out$/)
  })

  it('a summary cut at the output limit or too short falls back to the built-in summary', async ($, on) => {
    const w = world(on, { key: 'KEY', mode: 'summary' })
    w.replies.push({ status: 200, text: summarized(SUMMARY_TEXT, 'MAX_TOKENS') })
    w.replies.push({ status: 200, text: summarized('Fixed the bug.') })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.builtIn).toEqual(['manual', 'manual'])
    expect(w.logs).toEqual(['built-in summary: the summary hit the output token limit', 'built-in summary: the summary is too short (14 chars)'])
  })

  it('takes a summary that is only a little smaller, and refuses one that is not smaller', async ($, on) => {
    const w = world(on, { key: 'KEY', mode: 'summary' })
    const small: SessionMessage[] = [
      { role: 'user', text: 'a'.repeat(500), toolUses: [], handle: 'h0' },
      ...MESSAGES.slice(3),
    ]
    w.replies.push({ status: 200, text: summarized('b'.repeat(250)) })
    w.replies.push({ status: 200, text: summarized('b'.repeat(900)) })
    const taken = await $.session.compact({ trigger: 'manual', messages: small })
    expect(taken.messages?.[0]?.text).toContain('b'.repeat(250))
    await $.session.compact({ trigger: 'manual', messages: small })
    expect(w.builtIn).toEqual(['manual'])
    expect(w.logs[1]).toMatch(/^built-in summary: the summary is not smaller \(summary: 7 → 7 messages · -\d+% smaller/)
  })

  it('at off stops the automatic compaction', async ($, on) => {
    const w = world(on, { key: 'KEY', store: [['atPercent', 0]] })
    w.percent = 95
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.builtIn).toEqual([])
  })
})
