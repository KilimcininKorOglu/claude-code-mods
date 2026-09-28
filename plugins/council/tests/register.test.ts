import { describe, expect, mock, test, tier, type Engine, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, SessionMessage, ToolSpec } from 'claude-code'

import { forkMemberPrompt, MEMBER_SYSTEM, SYSTEM_GUIDANCE, TOOL_ID } from '../hooks/prompts.ts'

tier('user')

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Fix the flaky test.', toolUses: [] },
  { role: 'assistant', text: 'Running it.', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'npm test' } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'FAIL timeout after 5000 ms', isError: true }] },
]

const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 }

const QUESTION = 'The test times out after two fixes. Is the timeout the cause?'

const run = (args: string): CommandRunInput => ({
  command: 'council', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const geminiReply = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })

/** gemini-core as an inline plugin: it adds `$.gemini`, whose calls the world answers. */
const CORE: Plugin = {
  name: 'gemini-core',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), gemini: { enroll: stub, settings: stub, request: stub, read: stub, configure: stub } }))
  },
}

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const it = (name: string, body: TestBody) => test(name, { plugins: [CORE] }, body)

/** What gemini-core holds: a key or none, the tier, and whether it is older than the model a request names. */
type Core = { key?: string; tier: 'free' | 'paid'; old: boolean }

type World = {
  clock: MockClock
  core: Core
  store: Map<string, unknown>
  /** A Claude model's answer; null fails it with an overloaded API error. */
  claude: Map<string, string | null>
  completes: { model: string; system?: string; prompt: string; effort?: string }[]
  forks: string[]
  /** Every fork fails with an overloaded API error. */
  forkFails: boolean
  /** Every fork answers that the session has no response to fork yet. */
  nothingToFork: boolean
  fetches: { url: string; key: string | undefined; body: string }[]
  statuses: number[]
  enrolled: unknown[]
  tools: ToolSpec[]
  sent: string[]
  logs: string[]
}

function answerOf(w: World, model: string) {
  const text = w.claude.get(model)
  if (text === null) return { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
  return { isAnswered: true, text: text ?? `the answer of ${model}`, usage: USAGE }
}

function forkOf(w: World, prompt: string) {
  w.forks.push(prompt)
  if (w.forkFails) return { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
  if (w.nothingToFork) return { isAnswered: false, reason: 'nothing-to-fork' }
  return { isAnswered: true, text: prompt.startsWith('You chair') ? 'Verdict: follow A.' : 'the answer of the fork', usage: USAGE }
}

/** gemini-core's reading of a response, as far as these tests need it. */
function coreRead(e: { status: number; ok: boolean; text: string; attempt: number }) {
  if (e.status === 503 && e.attempt <= 3) return { retryInMs: 1000 * e.attempt }
  if (!e.ok) return { error: `Gemini HTTP ${e.status}: busy` }
  return { answer: { text: JSON.parse(e.text).candidates[0].content.parts[0].text, inputTokens: 1500, outputTokens: 40, finishReason: 'STOP' } }
}

function seatCore(on: On, w: World): void {
  on('gemini.enroll', (_, e) => { w.enrolled.push(e); return { value: undefined } })
  on('gemini.settings', () => ({ value: { hasKey: w.core.key !== undefined, keys: 1, tier: w.core.tier, model: 'gemini-3.8-flash', ownModels: true as const } }))
  on('gemini.request', (_, e) => {
    if (w.core.key === undefined) return { value: { error: 'no Gemini key' } }
    const model = w.core.old ? 'gemini-3.8-flash' : (e.model ?? 'gemini-3.8-flash')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    return { value: { http: { url, init: { method: 'POST' as const, headers: { 'x-goog-api-key': w.core.key }, body: JSON.stringify(e.body) } }, model, tier: w.core.tier } }
  })
  on('gemini.read', (_, e) => ({ value: coreRead(e) }))
}

function seatModels(on: On, w: World): void {
  on('model.complete', (_, e) => {
    w.completes.push({ model: e.model, prompt: e.prompt, ...(e.system === undefined ? {} : { system: e.system }), ...(e.effort === undefined ? {} : { effort: e.effort }) })
    return { value: answerOf(w, e.model) } as never
  })
  on('model.fork', (_, e) => ({ value: forkOf(w, e.prompt) }) as never)
  on('http.fetch', (_, e) => {
    w.fetches.push({ url: e.url, key: e.init?.headers?.['x-goog-api-key'], body: String(e.init?.body ?? '') })
    const status = w.statuses.shift() ?? 200
    return { value: { status, ok: status < 300, headers: {}, text: status < 300 ? geminiReply('the answer of gemini') : '{}' } }
  })
}

// Beneath the plugin: a store, the transcript, the models, gemini-core when the test loads it, and the send command.
function world(on: On, opts: { enabled?: boolean; key?: string | null; core?: boolean } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-26T10:00:00Z') }),
    core: { ...(opts.key === null ? {} : { key: opts.key ?? 'KEY' }), tier: 'free', old: false },
    store: new Map(opts.enabled === false ? [] : [['enabled', true]]),
    claude: new Map(), completes: [], forks: [], forkFails: false, nothingToFork: false, fetches: [], statuses: [], enrolled: [], tools: [], sent: [], logs: [],
  }
  if (opts.core !== false) seatCore(on, w)
  seatModels(on, w)
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('session.messages', () => ({ value: MESSAGES }))
  on('tool.register', (_, e) => { w.tools.push(e); return { value: { tool: `mcp__council__${e.name}` } } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'council:send' }, (_, e) => { w.sent.push(String(e.args)); return { text: '' } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  return w
}

const start = { surface: null, isInteractive: true, cwd: '/src/app' } as const

/** A main-loop request on `model`, so the council knows the model of the session. */
async function step($: Engine, model = 'claude-opus-5-5'): Promise<void> {
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model, messageCount: 3 })) void chunk
}

function answerSteps(on: On): void {
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: e.model } }
  })
}

const convene = ($: Engine, question: string = QUESTION, agentId?: string) =>
  $.tool.call({ tool: TOOL_ID, question, ...(agentId === undefined ? {} : { agentId }) } as never)

describe('council', () => {
  it('declares the tool only when on, and the system prompt note from the next session', async ($, on) => {
    const w = world(on, { enabled: false })
    on('prompt.section', (_, e) => ({ text: e.text }))
    await $.session.start(start)
    expect(w.tools).toEqual([])
    expect(w.enrolled).toEqual([{ consumer: 'council', defaultModel: 'gemini-3.8-flash', ownModels: true }])
    expect((await $.command.run(run('on'))).text).toContain('on: the model can call the council tool now')
    expect(w.tools.map(t => t.name)).toEqual(['convene'])
    expect((await $.prompt.section({ name: 'env_info_simple', text: 'W' })).text).toBe('W')
    await $.session.start(start)
    expect((await $.prompt.section({ name: 'env_info_simple', text: 'W' })).text).toBe(`W\n\n${SYSTEM_GUIDANCE}`)
  })

  it('off denies the tool and asks no model', async ($, on) => {
    const w = world(on, { enabled: false })
    expect((await convene($)).deny).toBe('the council is off; the user can turn it on with /council on')
    expect([w.completes, w.forks, w.fetches]).toEqual([[], [], []])
  })

  it('asks every member at once: the model of the session by fork, the others with the conversation, Gemini with its own model', async ($, on) => {
    const w = world(on)
    answerSteps(on)
    await step($)
    const r = await convene($)
    expect(w.completes.map(c => [c.model, c.effort])).toEqual([['claude-sonnet-5-5', 'high'], ['claude-fable-5-1', 'high'], ['claude-haiku-4-5-20251001', 'high']])
    expect(w.completes[0]?.system).toBe(MEMBER_SYSTEM)
    expect(w.completes[0]?.prompt).toContain('  [call] Bash {"command":"npm test"}\n  error: FAIL timeout after 5000 ms')
    expect(w.completes[0]?.prompt.endsWith(`The agent asks the council:\n\n${QUESTION}`)).toBe(true)
    expect(w.forks[0]).toBe(forkMemberPrompt(QUESTION))
    expect(w.fetches.map(f => f.url)).toEqual(['https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'])
    expect(r.result).toContain('Council verdict (5 of 5 members answered; the chair, opus 5.5, wrote it):\n\nVerdict: follow A.')
    expect(r.result).toContain('## A: opus 5.5 · 0 s\n\nthe answer of the fork')
    expect(r.result).toContain('## E: gemini-3.8-flash · 0 s\n\nthe answer of gemini')
  })

  it('the chair reads the answers by letter, without the models\' names', async ($, on) => {
    const w = world(on)
    answerSteps(on)
    await step($)
    await convene($)
    const chair = w.forks[1] ?? ''
    expect(chair.startsWith('You chair a council of models')).toBe(true)
    expect(chair).toContain('Member A:\nthe answer of the fork\n\nMember B:\nthe answer of claude-sonnet-5-5')
    expect(chair).not.toMatch(/opus|sonnet 5.5|haiku 4\.5/)
  })

  it('a member that fails is named with its reason, and the chair judges the rest', async ($, on) => {
    const w = world(on)
    answerSteps(on)
    await step($)
    w.claude.set('claude-sonnet-5-5', null)
    const r = await convene($)
    expect(r.result).toContain('(4 of 5 members answered;')
    expect(r.result).toContain('## sonnet 5.5 · no answer: api-error 529 overloaded')
    expect(w.forks[1]).toContain('4 members answered')
  })

  it('no answer from any member is a denial naming each reason, and no chair runs', async ($, on) => {
    const w = world(on, { key: null })
    answerSteps(on)
    await step($, 'claude-sonnet-5-5')
    for (const m of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001']) w.claude.set(m, null)
    w.forkFails = true
    const r = await convene($)
    expect(w.forks).toHaveLength(1)
    expect(r.deny).toContain('the council got no answer: opus 5.5: api-error 529 overloaded;')
    expect(r.deny).toContain('gemini-3.8-flash: gemini-core has no key')
  })

  it('the model of the session forks, whichever member it is, and a subagent\'s call sends no conversation', async ($, on) => {
    const w = world(on)
    answerSteps(on)
    await step($, 'claude-sonnet-5-5[1m]')
    await convene($)
    expect(w.completes.map(c => c.model)).toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001'])
    w.completes.length = 0
    w.forks.length = 0
    await convene($, QUESTION, 'agent-1')
    expect(w.forks).toEqual([])
    expect(w.completes.map(c => c.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5'])
    expect(w.completes[0]?.prompt).toContain('The conversation is not available; only the question is.')
    expect(w.completes[4]?.prompt.startsWith('You chair a council of models')).toBe(true)
  })

  it('names the chair as the session while its model is unknown, and completes where there is nothing to fork', async ($, on) => {
    const w = world(on)
    answerSteps(on)
    // After a module reload no main-loop request has named the model yet; the fork still runs on it.
    expect((await convene($)).result).toContain('(5 of 5 members answered; the chair, the model of the session, wrote it)')
    await step($)
    w.nothingToFork = true
    w.completes.length = 0
    const r = await convene($)
    expect(w.completes.map(c => c.model)).toEqual(['claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001', 'claude-opus-5-5', 'claude-opus-5-5'])
    expect(w.completes[3]?.system).toBe(MEMBER_SYSTEM)
    expect(r.result).toContain('the chair, opus 5.5, wrote it')
  })

  it('a missing question is refused', async ($, on) => {
    world(on)
    expect((await convene($, '  ')).deny).toContain('question is required')
  })
})

describe('Gemini members', () => {
  test('are skipped with the reason when gemini-core is not installed', async ($, on) => {
    const w = world(on, { core: false })
    answerSteps(on)
    await $.session.start(start)
    await step($)
    const r = await convene($)
    expect(r.result).toContain('## gemini-3.8-flash · no answer: gemini-core is not installed')
    expect(w.fetches).toEqual([])
    expect(w.logs).not.toContain(expect.stringContaining('refused the enrollment'))
  })

  it('are skipped when gemini-core has no key, and fail with a reason when it is older than the model a request names', async ($, on) => {
    const w = world(on, { key: null })
    answerSteps(on)
    await step($)
    expect((await convene($)).result).toContain('## gemini-3.8-flash · no answer: gemini-core has no key')
    w.core.key = 'KEY'
    w.core.old = true
    await $.command.run(run('members opus gemini-3.1-pro-preview'))
    expect((await convene($)).result).toContain('## gemini-3.1-pro-preview · no answer: gemini-core is older than 0.3.0 and sends every request to one model; update it')
  })

  it('each asks its own model, and a 503 goes again at once without a wait', async ($, on) => {
    const w = world(on)
    answerSteps(on)
    await step($)
    await $.command.run(run('members gemini-3.1-pro-preview gemini-3.8-flash'))
    w.statuses.push(503)
    const r = await convene($)
    expect(w.fetches.map(f => f.url.split('/models/')[1])).toEqual(['gemini-3.1-pro-preview:generateContent', 'gemini-3.8-flash:generateContent', 'gemini-3.1-pro-preview:generateContent'])
    expect(r.result).toContain('(2 of 2 members answered;')
    expect(JSON.parse(w.fetches[0]?.body ?? '{}').contents[0].parts[0].text.startsWith(MEMBER_SYSTEM)).toBe(true)
  })
})

describe('/council', () => {
  it('sets, shows and resets the members, and refuses a typo', async ($, on) => {
    const w = world(on)
    expect((await $.command.run(run('members'))).text).toBe('members: opus 5.5, sonnet 5.5, fable 5.1, haiku 4.5, gemini-3.8-flash')
    expect((await $.command.run(run('members sonnet gemini-3.1-pro-preview'))).text).toBe('members: sonnet 5.5, gemini-3.1-pro-preview')
    expect(w.store.get('members')).toEqual(['sonnet', 'gemini-3.1-pro-preview'])
    expect((await $.command.run(run('members opus sonet'))).text).toContain('sonet is not a model')
    expect((await $.command.run(run('members reset'))).text).toBe('members: opus 5.5, sonnet 5.5, fable 5.1, haiku 4.5, gemini-3.8-flash')
    expect(w.store.has('members')).toBe(false)
  })

  it('the status names the members, why a Gemini member is skipped, the chair and the last run', async ($, on) => {
    world(on, { key: null })
    answerSteps(on)
    await step($)
    await convene($)
    expect((await $.command.run(run(''))).text).toBe([
      'on: the model can call the council when it is stuck',
      'members: opus 5.5, sonnet 5.5, fable 5.1, haiku 4.5, gemini-3.8-flash (skipped: gemini-core has no key)',
      'chair: opus 5.5, the model of the session, forked',
      'last: 4 of 5 members answered in 0s; the chair wrote the verdict',
    ].join('\n'))
  })

  it('a question runs the council while it is off, and the verdict reaches the model through /council:send', async ($, on) => {
    const w = world(on, { enabled: false })
    answerSteps(on)
    await step($)
    expect((await $.command.run(run('Is the timeout the cause?'))).text).toBe('convened: 5 members; the verdict comes as a message when they have answered')
    await w.clock.settle()
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]?.startsWith('I convened the council with /council.')).toBe(true)
    expect(w.sent[0]).toContain('My question:\n\nIs the timeout the cause?\n\nCouncil verdict (5 of 5 members answered;')
    expect(w.logs).toEqual(['5 of 5 members answered in 0s; the chair wrote the verdict'])
  })

  it('a setting another window stored applies here at the next hook that acts on it', async ($, on) => {
    const w = world(on, { enabled: false })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('prompt.section', (_, e) => ({ text: e.text }))
    await $.session.start(start)
    await $.turn.start({ text: 'devam et', turnId: 't1' })
    expect(w.tools).toEqual([])
    // Every window shares the store: another one ran /council on, and this one never ran the command.
    w.store.set('enabled', true)
    await $.turn.start({ text: 'devam et', turnId: 't2' })
    expect(w.tools.map(t => t.name)).toEqual(['convene'])
    await $.turn.start({ text: 'devam et', turnId: 't3' })
    expect(w.tools).toHaveLength(1)
    // The note waits for /clear, as after /council on in this window, so the prompt the cache holds stays.
    expect((await $.prompt.section({ name: 'env_info_simple', text: 'W' })).text).toBe('W')
    // Another window turns the council off: the tool refuses at once.
    w.store.set('enabled', false)
    expect((await convene($)).deny).toBe('the council is off; the user can turn it on with /council on')
  })
})

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [CORE, SIDEBAR] }, body)

withSidebar('an open sidebar shows each member as it answers, the chair, and the verdict\'s first line', async ($, on) => {
  const w = world(on)
  const sections: { lines: { text: string }[]; until: string; order?: number }[] = []
  on('sidebar.set', (_, e) => { sections.push(e as never); return { value: true } })
  answerSteps(on)
  await step($)
  w.claude.set('claude-haiku-4-5-20251001', null)
  await convene($)
  expect(sections[0]?.lines.map(l => l.text)).toEqual([
    `${QUESTION.slice(0, 59)}… · running 0s`,
    'opus 5.5 · fork · running',
    'sonnet 5.5 · complete · running',
    'fable 5.1 · complete · running',
    'haiku 4.5 · complete · running',
    'gemini-3.8-flash · gemini · running',
    'chair · opus 5.5 · fork · waiting',
  ])
  expect(sections.at(-1)?.lines.map(l => l.text)).toEqual([
    `${QUESTION.slice(0, 59)}… · done in 0s`,
    'opus 5.5 · fork · answered 0s · 2.1k in, 50 out',
    'sonnet 5.5 · complete · answered 0s · 2.1k in, 50 out',
    'fable 5.1 · complete · answered 0s · 2.1k in, 50 out',
    'haiku 4.5 · complete · failed: api-error 529 overloaded',
    'gemini-3.8-flash · gemini · answered 0s · 1.5k in, 40 out · free tier',
    'chair · opus 5.5 · fork · done 0s',
    'verdict: follow A.',
  ])
  expect(sections.at(-1)).toMatchObject({ title: 'run', until: 'session', order: 7 })
  expect(w.logs).toEqual([])
})
