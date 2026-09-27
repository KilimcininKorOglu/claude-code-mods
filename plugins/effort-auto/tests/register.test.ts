import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { keepsCacheAcrossEffort, levelOf, raterPrompt } from '../hooks/effort.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'effort-auto', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const USAGE = { input_tokens: 90, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/**
 * `reply` is the rater's answer, or null for a rater that fails; `asked` holds each rating request;
 * `sent` holds the effort each model request went out with; `logs` holds the transcript lines.
 */
type World = { reply: string | null; asked: { model: string; effort?: string; prompt: string }[]; sent: (string | number | undefined)[]; logs: string[] }

function world(on: On): World {
  const w: World = { reply: 'max', asked: [], sent: [], logs: [] }
  mock.store(on, {})
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', (_, e) => {
    w.asked.push({ model: e.model, effort: e.effort, prompt: e.prompt })
    return { value: w.reply === null ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } : { isAnswered: true, text: w.reply, usage: USAGE } } as never
  })
  on('turn.step', async function* (_, e) {
    w.sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: { ...USAGE, model: e.model } }
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/w' })
}

const prompt = ($: Engine, text: string, kind: 'composer' | 'task-notification' = 'composer', turnId?: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind }, ...(turnId === undefined ? {} : { turnId }) } as never)

async function step($: Engine, model = 'claude-opus-5-5', agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model, messageCount: 1, effort: 'high', ...(agentId === undefined ? {} : { agentId }) })
  for await (const chunk of stream) void chunk
}

const turnEnds = ($: Engine, agentId?: string) => $.turn.complete({ turnId: 't', answer: '', reason: 'done', ...(agentId === undefined ? {} : { agentId }) } as never)

describe('effort', () => {
  test('a level is read from the rater\'s one word, and nothing else passes', () => {
    expect(levelOf('xhigh')).toBe('xhigh')
    expect(levelOf(' Max.\n')).toBe('max')
    expect(levelOf('very high')).toBe(undefined)
    expect(levelOf('')).toBe(undefined)
  })

  test('only the models whose cache survives an effort change are changed', () => {
    expect(keepsCacheAcrossEffort('claude-opus-5-5')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-opus-5-5[1m]')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-fable-5-1')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-sonnet-5')).toBe(false)
    expect(keepsCacheAcrossEffort('claude-opus-5')).toBe(false)
  })

  test('a long prompt reaches the rater cut', () => {
    expect(raterPrompt('x'.repeat(5000))).toContain(`${'x'.repeat(4000)}\n[cut]`)
  })
})

describe('effort-auto', () => {
  test('the person\'s prompt is rated by haiku at low effort, and each main-loop request of its turn goes out at that level', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'redesign the cache layer')
    expect(w.asked).toEqual([{ model: 'haiku', effort: 'low', prompt: 'The request:\n<request>\nredesign the cache layer\n</request>\nThe level:' }])
    await step($)
    await step($)
    expect(w.sent).toEqual(['max', 'max'])
    expect(w.logs).toEqual(['this turn max · session high'])
  })

  test('the next turn starts from the session\'s effort, and a subagent keeps its own', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'hard work')
    await step($, 'claude-opus-5-5', 'agent-1')
    await turnEnds($, 'agent-1')
    await step($)
    await turnEnds($)
    await step($)
    expect(w.sent).toEqual(['high', 'max', 'high'])
  })

  test('a model whose cache an effort change would rewrite is left alone, and its prompts are not rated', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'hard work')
    await step($, 'claude-sonnet-5')
    expect(w.sent).toEqual(['high'])
    expect(w.logs).toEqual([])
    // Once a request named that model, the next prompt is not even rated.
    await prompt($, 'more hard work')
    expect(w.asked).toHaveLength(1)
  })

  test('a notification, a prompt typed over a running turn, and a rater that fails or answers no level keep the session\'s effort', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'task done', 'task-notification')
    await prompt($, 'also this', 'composer', 'running-turn')
    expect(w.asked).toEqual([])
    w.reply = null
    await prompt($, 'hard work')
    await step($)
    w.reply = 'it depends'
    await prompt($, 'hard work')
    await step($)
    expect(w.sent).toEqual(['high', 'high'])
    expect(w.logs).toEqual([
      "the rater did not answer (api-error), so this turn keeps the session's effort",
      'the rater answered "it depends", so this turn keeps the session\'s effort',
    ])
  })

  test('off rates nothing, and the command answers its state', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('off'))).text).toBe("off: every turn runs at the session's effort")
    await prompt($, 'hard work')
    await step($)
    expect(w.asked).toEqual([])
    expect(w.sent).toEqual(['high'])
    expect((await $.command.run(run(''))).text).toBe('off')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })
})

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

withSidebar('an open sidebar holds this turn\'s effort while it runs and the last turn\'s after it for the whole session, the levels coloured', async ($, on) => {
  const w = world(on)
  const sections: { lines: { text: string }[] }[] = []
  const cleared: unknown[] = []
  on('sidebar.set', (_, e) => { sections.push(e as never); return { value: true } })
  on('sidebar.clear', (_, e) => { cleared.push(e); return { value: undefined } })
  await started($)
  await prompt($, 'hard work')
  await step($)
  await step($)
  expect(sections[0]).toEqual({
    consumer: 'effort-auto', key: 'effort', title: 'effort', until: 'session', order: 6,
    lines: [{ text: 'this turn max · session high', parts: [{ text: 'this turn ' }, { text: 'max', kind: 'error' }, { text: ' · ' }, { text: 'session ' }, { text: 'high', kind: 'warn' }] }],
  })
  // The turn's end keeps its level as the last turn's, and a turn that was not rated shows the session's.
  await turnEnds($)
  await prompt($, 'task done', 'task-notification')
  await step($)
  await turnEnds($)
  expect(sections.map(s => s.lines[0]?.text)).toEqual([
    'this turn max · session high',
    'last turn max · session high',
    'this turn high (session) · session high',
    'last turn high (session) · session high',
  ])
  expect(cleared).toEqual([])
  expect(w.logs).toEqual([])
  // Off takes the line down.
  await $.command.run(run('off'))
  expect(cleared).toEqual([{ consumer: 'effort-auto', key: 'effort' }])
})
