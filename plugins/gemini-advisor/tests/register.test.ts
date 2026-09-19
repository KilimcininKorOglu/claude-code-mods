import { describe, expect, mock, test, tier, type MockClock } from 'claude-code/testing'
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

type World = {
  clock: MockClock
  store: Map<string, unknown>
  requests: { url: string; body: string; key: string | undefined }[]
  replies: { status: number; text: string }[]
  tools: ToolSpec[]
  toasts: string[]
  reads: number
}

// Beneath the plugin: a store, a transcript, Gemini answering from a script.
function world(on: On, opts: { key?: string; store?: [string, unknown][] } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    store: new Map(opts.store ?? []),
    requests: [],
    replies: [],
    tools: [],
    toasts: [],
    reads: 0,
  }
  on('env.get', (_, e) => ({ value: e.name === 'GEMINI_API_KEY' ? opts.key : undefined }))
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
  test('declares the advise tool with the model in its description and when to call it', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start(start)
    expect(w.tools).toHaveLength(1)
    expect(w.tools[0]?.name).toBe('advise')
    expect(w.tools[0]?.description).toContain('Gemini (gemini-3.8-flash)')
    expect(w.tools[0]?.description).toContain('before you tell the user the work is done')
    expect(w.tools[0]?.inputSchema).toMatchObject({ required: ['message'] })
  })

  test('tells the model in the system prompt when to call the tool and how to load it', async ($, on) => {
    world(on)
    on('prompt.section', (_, e) => ({ text: e.text }))
    const r = await $.prompt.section({ name: 'env_info_simple', text: 'Working directory: /src' })
    expect(r.text).toBe(`Working directory: /src\n\n${SYSTEM_GUIDANCE}`)
    expect(SYSTEM_GUIDANCE).toContain('select:mcp__gemini-advisor__advise')
    expect(SYSTEM_GUIDANCE).toContain('when you choose between two approaches')
    expect((await $.prompt.section({ name: 'memory', text: 'm' })).text).toBe('m')
    expect((await $.prompt.section({ name: 'env_info_simple', text: null })).text).toBe(null)
  })

  test('sends the conversation and the message, and answers with the advice', async ($, on) => {
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

  test('a subagent\'s call sends only its message', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply('Looks right.') })
    await $.tool.call({ tool: TOOL, message: 'Is this right?', agentId: 'a1' })
    expect(w.reads).toBe(0)
    expect(w.requests[0]?.body).toContain('The conversation is not available')
    expect(w.toasts[0]).toContain('· message only ·')
  })

  test('tells the model why when it is off or has no key, and asks nothing', async ($, on) => {
    const w = world(on, { store: [['enabled', false]] })
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toContain('gemini-advisor is off')
    w.store.delete('enabled')
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toContain('has no Gemini key')
    expect(w.requests).toEqual([])
  })

  test('turns a Gemini error, a cut advice and a missing message into a denial the model reads', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) })
    w.replies.push({ status: 200, text: reply('Half an ans', 'MAX_TOKENS') })
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toBe('Gemini advisor failed: Gemini HTTP 429: Resource has been exhausted')
    expect((await $.tool.call({ tool: TOOL, message: 'x' })).deny).toContain('output token limit')
    expect((await $.tool.call({ tool: TOOL, message: '  ' })).deny).toContain('message is required')
    expect(w.requests).toHaveLength(2)
  })

  test('asks again after a 503, and gives up after the third attempt', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    const busy = { status: 503, text: JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }) }
    w.replies.push(busy, busy, { status: 200, text: reply('Fine.') })
    const first = $.tool.call({ tool: TOOL, message: 'x' })
    await w.clock.advance(2000)
    expect(w.requests).toHaveLength(2)
    await w.clock.advance(4000)
    expect((await first).result).toBe('Fine.')
    expect(w.requests).toHaveLength(3)
    w.replies.push(busy, busy, busy)
    const second = $.tool.call({ tool: TOOL, message: 'x' })
    await w.clock.advance(2000)
    await w.clock.advance(4000)
    expect((await second).deny).toContain('Gemini HTTP 503: This model is currently experiencing high demand.')
    expect(w.requests).toHaveLength(6)
  })

  test('the command stores the settings, declares the tool again for a new model, and shows the status', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start(start)
    expect((await $.command.run(run('model gemini-3.1-pro-preview'))).text).toContain('model gemini-3.1-pro-preview')
    expect(w.tools.at(-1)?.description).toContain('Gemini (gemini-3.1-pro-preview)')
    expect((await $.command.run(run('paid'))).text).toBe('paid tier')
    w.replies.push({ status: 200, text: reply('ok') })
    await $.tool.call({ tool: TOOL, message: 'x' })
    expect(w.requests[0]?.url).toContain('/models/gemini-3.1-pro-preview:generateContent')
    expect(w.toasts[0]).not.toContain('free tier')
    expect((await $.command.run(run(''))).text).toBe('on · gemini-3.1-pro-preview · paid tier · key set\nlast: asked gemini-3.1-pro-preview · 3 messages · 2k in, 40 out')
    expect((await $.command.run(run('reset'))).text).toBe('settings reset to the plugin options')
    expect([...w.store.keys()]).toEqual([])
    expect(w.tools.at(-1)?.description).toContain('Gemini (gemini-3.8-flash)')
  })
})
