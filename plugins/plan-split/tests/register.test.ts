import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { mainLoopMode, parseModel, resolved, routeFor, sectionLines, storedModel, type Route } from '../hooks/split'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'plan-split', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const USAGE = { input_tokens: 90, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The ids Claude Code's aliases stand for in the measured environment. */
const ENV = { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5-1[1m]', ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]' }

/**
 * `sent` holds the model each request went out with, `logs` the transcript lines, `store` the store every
 * window shares, which a test writes as another window; `toolFails` makes the next plan-mode tool fail.
 */
type World = { sent: string[]; logs: string[]; store: Map<string, unknown>; toolFails: boolean }

function world(on: On, store: Record<string, unknown> = { enabled: true }): World {
  const w: World = { sent: [], logs: [], store: new Map(Object.entries(store)), toolFails: false }
  mock.env(on, ENV)
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => (w.toolFails ? { result: 'The user rejected the plan', isError: true } : { result: 'ok' }) as never)
  on('turn.step', async function* (_, e) {
    w.sent.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: { ...USAGE, model: e.model } }
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/w' })
}

/** One model request on the session's model, from the main loop or from the subagent `agentId`. */
async function step($: Engine, agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  for await (const chunk of stream) void chunk
}

const planTool = ($: Engine, tool: 'EnterPlanMode' | 'ExitPlanMode', agentId?: string) =>
  $.tool.call({ tool, input: {}, toolUseId: `u-${tool}`, ...(agentId === undefined ? {} : { agentId }) } as never)

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world hooks of the test answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}
const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

describe('split', () => {
  const route: Route = { plan: 'fable', code: 'opus', env: ENV }

  test('plan mode routes to the plan model, every other mode to the code model, and no known mode to none', () => {
    expect(routeFor('plan', route)).toBe('claude-fable-5-1[1m]')
    expect(routeFor('default', route)).toBe('claude-opus-5-5[1m]')
    expect(routeFor('acceptEdits', route)).toBe('claude-opus-5-5[1m]')
    expect(routeFor('auto', route)).toBe('claude-opus-5-5[1m]')
    expect(routeFor(undefined, route)).toBe(undefined)
  })

  test('an alias reads as its environment variable, a bare alias goes as written, and a model id stays', () => {
    expect(resolved('Fable', ENV)).toBe('claude-fable-5-1[1m]')
    // Measured on 2.1.322: the engine takes a bare alias and answers on the newest model of it.
    expect(resolved('sonnet', ENV)).toBe('sonnet')
    expect(resolved('claude-sonnet-5-5', ENV)).toBe('claude-sonnet-5-5')
  })

  test('a model setting takes an alias or an id and refuses anything else', () => {
    expect(parseModel(' claude-fable-5-2[1m] ')).toEqual({ model: 'claude-fable-5-2[1m]' })
    expect(parseModel('')).toEqual({ error: 'expects a model: an alias (fable, opus, sonnet, haiku) or a model id' })
    expect(parseModel('rm -rf')).toEqual({ error: '"rm -rf" is not a model name' })
    expect(storedModel(42, 'opus')).toBe('opus')
    expect(storedModel('sonnet', 'opus')).toBe('sonnet')
  })

  test('only the main loop carries a mode; a subagent hook input names none', () => {
    expect(mainLoopMode({ permission_mode: 'plan' })).toBe('plan')
    expect(mainLoopMode({ permission_mode: 'plan', agent_id: 'a1' })).toBe(undefined)
    expect(mainLoopMode({})).toBe(undefined)
  })

  test('the section names the side and model in use, and both settings under it', () => {
    expect(sectionLines(route, undefined, undefined)).toEqual([
      { text: 'waiting for the first prompt', kind: 'dim' },
      { text: 'plan fable · code opus', kind: 'dim' },
    ])
    expect(sectionLines(route, 'plan', 'claude-fable-5-1[1m]')[0]).toEqual({
      text: 'plan · claude-fable-5-1[1m]',
      parts: [{ text: 'plan · ' }, { text: 'claude-fable-5-1[1m]', kind: 'ok' }],
    })
  })
})

describe('plan-split', () => {
  test('is off after an install, and leaves every request on the session model', async ($, on) => {
    const w = world(on, {})
    await started($)
    await planTool($, 'EnterPlanMode')
    await step($)
    expect(w.sent).toEqual(['claude-opus-5-5'])
    expect((await $.command.run(run(''))).text).toBe('off: plan mode on claude-fable-5-1[1m], every other mode on claude-opus-5-5[1m] · mode now plan')
  })

  test('a request with no known mode keeps the session model', async ($, on) => {
    const w = world(on)
    await started($)
    await step($)
    expect(w.sent).toEqual(['claude-opus-5-5'])
  })

  test('EnterPlanMode routes the next request to the plan model and an accepted ExitPlanMode back to the code model', async ($, on) => {
    const w = world(on)
    await started($)
    await planTool($, 'EnterPlanMode')
    await step($)
    await planTool($, 'ExitPlanMode')
    await step($)
    expect(w.sent).toEqual(['claude-fable-5-1[1m]', 'claude-opus-5-5[1m]'])
    expect(w.logs).toEqual(['plan mode: the main loop runs on claude-fable-5-1[1m]', 'default mode: the main loop runs on claude-opus-5-5[1m]'])
  })

  test('a rejected ExitPlanMode keeps plan mode, and a subagent keeps its own model', async ($, on) => {
    const w = world(on)
    await started($)
    await planTool($, 'EnterPlanMode')
    w.toolFails = true
    await planTool($, 'ExitPlanMode')
    await planTool($, 'ExitPlanMode', 'a1')
    await step($)
    await step($, 'a1')
    expect(w.sent).toEqual(['claude-fable-5-1[1m]', 'claude-opus-5-5'])
  })

  test('the commands set each side, refuse a wrong word, and turn the mod off and on', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('code sonnet'))).text).toBe('code: sonnet')
    expect(w.store.get('code')).toBe('sonnet')
    await planTool($, 'ExitPlanMode')
    await step($)
    expect(w.sent).toEqual(['sonnet'])
    expect((await $.command.run(run('plan'))).text).toBe('expects a model: an alias (fable, opus, sonnet, haiku) or a model id')
    expect((await $.command.run(run('maybe'))).text).toBe('expects nothing (the status), on, off, plan <model> or code <model>')
    expect((await $.command.run(run('off'))).text).toBe('off: the main loop keeps the session model')
    await step($)
    expect(w.sent).toEqual(['sonnet', 'claude-opus-5-5'])
    expect((await $.command.run(run('on'))).text).toBe('on: plan mode on claude-fable-5-1[1m], every other mode on sonnet')
  })

  test('a setting another window stored applies here at the next hook that acts on it', async ($, on) => {
    const w = world(on)
    await started($)
    await planTool($, 'EnterPlanMode')
    w.store.set('plan', 'haiku')
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
    await step($)
    w.store.set('enabled', false)
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
    await step($)
    expect(w.sent).toEqual(['haiku', 'claude-opus-5-5'])
  })

  withSidebar('an open sidebar takes the section, and off drops it', async ($, on) => {
    const w = world(on)
    const sections: { text: string }[][] = []
    const cleared: string[] = []
    on('sidebar.set', (_, e) => {
      sections.push((e as unknown as { lines: { text: string }[] }).lines)
      return { value: true }
    })
    on('sidebar.clear', (_, e) => {
      cleared.push((e as unknown as { key: string }).key)
      return { value: undefined }
    })
    await started($)
    await planTool($, 'EnterPlanMode')
    await step($)
    expect(sections.at(-1)?.map(l => l.text)).toEqual(['plan · claude-fable-5-1[1m]', 'plan fable · code opus'])
    expect(w.logs).toEqual([])
    await $.command.run(run('off'))
    expect(cleared).toEqual(['models'])
  })
})
