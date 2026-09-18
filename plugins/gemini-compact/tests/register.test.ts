import { describe, expect, mock, test, tier, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On, SessionMessage, TurnCompleteInput } from 'claude-code'

tier('user')

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
  store: Map<string, unknown>
  requests: { url: string; body: string; key: string | undefined }[]
  replies: { status: number; text: string }[]
  logs: string[]
  toasts: string[]
  builtIn: string[]
  percent: number
}

// Beneath the plugin: a store, Gemini answering from a script, and the
// engine's own compaction, which answers with a one-message summary.
function world(on: On, opts: { key?: string; store?: [string, unknown][] } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    store: new Map(opts.store ?? []),
    requests: [],
    replies: [],
    logs: [],
    toasts: [],
    builtIn: [],
    percent: 10,
  }
  mock.env(on, opts.key === undefined ? {} : { GEMINI_API_KEY: opts.key })
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
  test('replaces the summary with the conversation less what Gemini dropped', async ($, on) => {
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

  test('falls back to the built-in summary when the decisions remove too little', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: answer([{ id: 'c1', action: 'keep' }]) })
    const r = await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    expect(r.messages).toEqual(SUMMARY)
    expect(w.builtIn).toEqual(['auto'])
    expect(w.logs[0]).toMatch(/^built-in summary: under 25% smaller \(kept 9\/9 messages · 0% smaller/)
  })

  test('falls back on a Gemini error, a bad answer and a missing key, and says why', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) })
    w.replies.push({ status: 200, text: answer([]) })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.builtIn).toEqual(['manual', 'manual'])
    expect(w.logs).toEqual(['built-in summary: Gemini HTTP 429: Resource has been exhausted', 'built-in summary: no decision for c1'])
  })

  test('without a key it asks nothing and uses the built-in summary', async ($, on) => {
    const w = world(on)
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.requests).toEqual([])
    expect(w.logs).toEqual(['built-in summary: no Gemini key (set GEMINI_API_KEY or the plugin option)'])
  })

  test('leaves a subagent compaction and a compaction while off to the engine', async ($, on) => {
    const w = world(on, { key: 'KEY', store: [['enabled', false]] })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    w.store.delete('enabled')
    await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MESSAGES })
    expect(w.requests).toEqual([])
    expect(w.builtIn).toEqual(['manual', 'auto'])
  })

  test('uses the model and the tier the command stored, and says paid without the free warning', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/src/app' })
    expect((await $.command.run(run('model gemini-3.5-flash'))).text).toBe('model gemini-3.5-flash')
    expect((await $.command.run(run('paid'))).text).toBe('paid tier')
    w.replies.push({ status: 200, text: answer([{ id: 'c1', action: 'drop' }]) })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect(w.requests[0]?.url).toContain('/models/gemini-3.5-flash:generateContent')
    expect(w.toasts[0]).not.toContain('free tier')
    const status = (await $.command.run(run(''))).text
    expect(status).toMatch(/^on · gemini-3\.5-flash · automatic at 60% · paid tier · key set\nlast: kept 8\/9/)
    expect((await $.command.run(run('reset'))).text).toBe('settings reset to the plugin options')
    expect([...w.store.keys()]).toEqual([])
    expect((await $.command.run(run('at 150'))).text).toContain('1 to 99')
  })

  test('a finished turn over the threshold starts a compaction without holding the turn', async ($, on) => {
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

  test('does not compact again until the context was under the threshold', async ($, on) => {
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

  test('at off stops the automatic compaction', async ($, on) => {
    const w = world(on, { key: 'KEY', store: [['atPercent', 0]] })
    w.percent = 95
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.builtIn).toEqual([])
  })
})
