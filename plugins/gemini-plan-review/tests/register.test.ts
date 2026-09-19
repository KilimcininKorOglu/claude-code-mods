import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, PromptSubmitInput, SessionMessage } from 'claude-code'

tier('user')

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Plan a CSV export for the orders page.', toolUses: [] },
  { role: 'assistant', text: 'Here is the plan.', toolUses: [] },
]

const PLAN = '# CSV export\n\n1. Add an export button.\n2. Stream the rows.'

/** The engine's plan mode note, as far as the plan file (measured on 2.1.278). */
const PLAN_MODE_NOTE = 'Plan mode is active.\n\n## Plan File Info:\nNo plan file exists yet. You should create your plan at /Users/u/.claude/plans/test-of-a-plan.md using the Write tool.\n\n## Plan Workflow'

const run = (args: string): CommandRunInput => ({
  command: 'gemini-plan-review', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const prompt = (kind: 'composer' | 'task-notification'): PromptSubmitInput => ({ text: 'go on', wait: false, origin: { kind } })

const reply = (findings: unknown[]) =>
  JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ findings }) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12_400, candidatesTokenCount: 300 },
  })

const BLOCKER = { severity: 'blocker', message: 'The plan has no step that checks the export against real orders.' }
const MINOR = { severity: 'minor', message: 'Name the file after the date.' }

type World = {
  clock: MockClock
  store: Map<string, unknown>
  requests: { url: string; body: string }[]
  replies: { status: number; text: string }[]
  approvals: number
  toasts: string[]
  logs: string[]
  reads: number
  enrolled: string[]
  files: string[]
}

/** What gemini-core holds for this mod. */
type Core = { key?: string; tier?: 'free' | 'paid'; model?: string }

/** gemini-core as an inline plugin: it adds `$.gemini`, whose calls the hooks of `seatCore` answer. */
const CORE: Plugin = {
  name: 'gemini-core',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), gemini: { enroll: stub, settings: stub, request: stub, read: stub, configure: stub } }))
  },
}

/** A test with gemini-core loaded beside the plugin. */
const it = (name: string, body: TestBody) => test(name, { plugins: [CORE] }, body)

/** gemini-core's reading of a response, as far as these tests need it (gemini-core's tests cover the rest). */
function coreRead(e: { status: number; ok: boolean; text: string }) {
  const value = JSON.parse(e.text)
  if (!e.ok) return { error: `Gemini HTTP ${e.status}: ${value.error.message}` }
  const usage = value.usageMetadata
  return { answer: { text: value.candidates[0].content.parts[0].text, inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, finishReason: value.candidates[0].finishReason } }
}

/** gemini-core, seated beneath the plugin: `$.gemini` answered from `core`. */
function seatCore(on: On, core: Core, enrolled: string[]): void {
  const tierOf = core.tier ?? 'free'
  const model = core.model ?? 'gemini-3.8-flash'
  on('gemini.enroll', (_, e) => { enrolled.push(`${e.consumer} ${e.defaultModel}`); return { value: undefined } })
  on('gemini.settings', () => ({ value: { hasKey: core.key !== undefined, keys: core.key === undefined ? 0 : 1, tier: tierOf, model } }))
  on('gemini.request', (_, e) => {
    if (core.key === undefined) return { value: { error: 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option' } }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    return { value: { http: { url, init: { method: 'POST' as const, headers: { 'x-goog-api-key': core.key }, body: JSON.stringify(e.body) } }, model, tier: tierOf } }
  })
  on('gemini.read', (_, e) => ({ value: coreRead(e) }))
}

// Beneath the plugin: a store, a transcript, Gemini from a script, and the approval dialog itself.
// The store holds the review turned on unless a test gives its own.
function world(on: On, opts: Core & { store?: [string, unknown][] } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    store: new Map(opts.store ?? [['enabled', true]]),
    requests: [],
    replies: [],
    approvals: 0,
    toasts: [],
    logs: [],
    reads: 0,
    enrolled: [],
    files: [],
  }
  seatCore(on, opts, w.enrolled)
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('session.messages', () => { w.reads++; return { value: MESSAGES } })
  on('fs.read', (_, e) => { w.files.push(e.path); return { value: '# From the file\n\n1. Step.' } })
  on('http.fetch', (_, e) => {
    w.requests.push({ url: e.url, body: String(e.init?.body ?? '') })
    const r = w.replies.shift() ?? { status: 500, text: JSON.stringify({ error: { message: 'no reply scripted' } }) }
    return { value: { status: r.status, ok: r.status < 300, headers: {}, text: r.text } }
  })
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('tool.call', { tool: 'ExitPlanMode' }, () => {
    w.approvals++
    return { result: 'approved' }
  })
  return w
}

const exitPlan = (plan = PLAN) => ({ tool: 'ExitPlanMode' as const, plan })
const reviewText = (w: World, i = 0) => JSON.parse(w.requests[i]?.body ?? '{}').contents[0].parts[0].text as string

describe('gemini-plan-review', () => {
  it('sends a plan with a blocker back before the dialog, and tells the model how to answer a wrong finding', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply([BLOCKER, MINOR]) })
    const r = await $.tool.call(exitPlan())
    expect(w.approvals).toBe(0)
    expect(r.deny).toContain('(round 1 of 2)')
    expect(r.deny).toContain('- The plan has no step that checks the export against real orders.')
    expect(r.deny).toContain('under a "## Gemini plan review" heading')
    expect(r.deny).toContain('Minor notes, not blocking:\n- Name the file after the date.')
    expect(reviewText(w)).toContain('#1 user: Plan a CSV export for the orders page.')
    expect(reviewText(w)).toContain('The plan:\n\n# CSV export')
    expect(w.toasts).toEqual(['plan reviewed · 1 blocker, 1 minor · 12k in, 300 out · sent to Gemini free tier'])
    expect(w.logs).toEqual(['plan sent back (round 1 of 2): plan reviewed · 1 blocker, 1 minor · 12k in, 300 out'])
  })

  it('lets the plan through after two rounds, with the open blockers for the model and the user', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push(...Array(3).fill({ status: 200, text: reply([BLOCKER]) }))
    expect((await $.tool.call(exitPlan())).deny).toContain('(round 1 of 2)')
    expect((await $.tool.call(exitPlan())).deny).toContain('(round 2 of 2)')
    const third = await $.tool.call(exitPlan())
    expect(w.approvals).toBe(1)
    expect(third.result).toBe('approved')
    expect(third.context).toEqual([expect.stringContaining('after 2 rounds with 1 blocking finding(s) still open:\n- The plan has no step')])
    expect(w.logs[2]).toBe('plan reached you after 2 rounds with 1 open blocker(s):\n- The plan has no step that checks the export against real orders.')
  })

  it('a user prompt gives the next plan its rounds again; a notification does not', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push(...Array(4).fill({ status: 200, text: reply([BLOCKER]) }))
    await $.tool.call(exitPlan())
    await $.prompt.submit(prompt('task-notification'))
    expect((await $.tool.call(exitPlan())).deny).toContain('(round 2 of 2)')
    await $.prompt.submit(prompt('composer'))
    expect((await $.tool.call(exitPlan())).deny).toContain('(round 1 of 2)')
    expect(w.approvals).toBe(0)
  })

  it('a clean plan reaches the user with a note that the review ran', async ($, on) => {
    const w = world(on, { key: 'KEY', tier: 'paid' })
    w.replies.push({ status: 200, text: reply([]) })
    const r = await $.tool.call(exitPlan())
    expect(r).toEqual({ result: 'approved', context: ['gemini-plan-review: Gemini reviewed this plan and found nothing to report.'] })
    expect(w.toasts).toEqual(['plan reviewed · 0 blocker, 0 minor · 12k in, 300 out'])
  })

  it('a Gemini error, a malformed answer or a missing key lets the plan through with a note', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) }, { status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no json' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }) })
    expect((await $.tool.call(exitPlan())).context).toEqual(['gemini-plan-review could not review this plan and let it reach the user: Gemini HTTP 429: Resource has been exhausted'])
    expect((await $.tool.call(exitPlan())).context?.[0]).toContain('the review is not JSON')
    expect(w.approvals).toBe(2)
    expect(w.logs).toEqual(['plan reached you without a review: Gemini HTTP 429: Resource has been exhausted', 'plan reached you without a review: the review is not JSON'])
  })

  it('without a key, for a subagent and while off, nothing is sent', async ($, on) => {
    const w = world(on)
    expect((await $.tool.call(exitPlan())).context?.[0]).toContain('no Gemini key')
    // The test engine passes `agentId` on as a subagent's call carries it; the type drops it.
    const subagent = { ...exitPlan(), agentId: 'a1' }
    expect(await $.tool.call(subagent)).toEqual({ result: 'approved' })
    w.store.set('enabled', false)
    expect(await $.tool.call(exitPlan())).toEqual({ result: 'approved' })
    expect(w.requests).toEqual([])
    expect(w.reads).toBe(0)
    expect(w.approvals).toBe(3)
  })

  it('reads the plan file over the plan the call carries, and lets a call with neither through', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply([]) })
    await $.tool.call({ ...exitPlan('# An older version'), planFilePath: '/Users/u/.claude/plans/p.md' })
    expect(w.files).toEqual(['/Users/u/.claude/plans/p.md'])
    expect(reviewText(w)).toContain('The plan:\n\n# From the file')
    const bare = await $.tool.call({ tool: 'ExitPlanMode', plan: '' })
    expect(bare.context).toEqual(['gemini-plan-review could not review this plan and let it reach the user: the call carries no plan text'])
    expect(w.requests).toHaveLength(1)
  })

  it('reads the file the plan mode note names when the call carries neither plan nor path', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply([]) })
    await $.prompt.attachment({ type: 'plan_mode', text: PLAN_MODE_NOTE, origin: { kind: 'engine' } })
    await $.tool.call({ tool: 'ExitPlanMode' })
    expect(w.files).toEqual(['/Users/u/.claude/plans/test-of-a-plan.md'])
    expect(w.requests).toHaveLength(1)
  })

  it('enrolls with gemini-core and shows the last review in the status', async ($, on) => {
    const w = world(on, { key: 'KEY', model: 'gemini-3.5-flash', tier: 'paid' })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/src/app' })
    expect(w.enrolled).toEqual(['gemini-plan-review gemini-3.8-flash'])
    w.replies.push({ status: 200, text: reply([MINOR]) })
    await $.tool.call(exitPlan())
    expect(w.requests[0]?.url).toContain('/models/gemini-3.5-flash:generateContent')
    expect((await $.command.run(run(''))).text).toBe('on · gemini-3.5-flash · thinking model default · paid tier · key set\nlast: plan reviewed · 0 blocker, 1 minor · 12k in, 300 out')
  })

  it('is off on a fresh install; on is refused without a key; reset turns it off', async ($, on) => {
    const w = world(on, { store: [] })
    expect(await $.tool.call(exitPlan())).toEqual({ result: 'approved' })
    expect((await $.command.run(run(''))).text).toContain('off until /gemini-plan-review on')
    expect((await $.command.run(run('on'))).text).toBe('still off: gemini-core has no Gemini key. Set GEMINI_API_KEY or the gemini-core apiKey option, restart Claude Code, then run /gemini-plan-review on')
    expect([...w.store.keys()]).toEqual([])
    expect((await $.command.run(run('paid'))).text).toBe('expects on, off, or reset; /gemini-core sets the model, the thinking level and the tier')
  })

  it('on and reset with a key', async ($, on) => {
    const w = world(on, { key: 'KEY', store: [] })
    expect((await $.command.run(run('on'))).text).toBe('on: every plan is reviewed before it reaches you')
    expect(w.store.get('enabled')).toBe(true)
    expect((await $.command.run(run('reset'))).text).toBe('off: back to the default; /gemini-plan-review on turns it on')
    expect([...w.store.keys()]).toEqual([])
  })
})
