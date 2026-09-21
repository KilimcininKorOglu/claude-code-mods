import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, TurnCompleteInput, TurnUsage } from 'claude-code'

import { fmtDuration, fmtTok, limitOf, rowText, shortModel, sidebarLines, tokensOf, totalText } from '../hooks/ledger.ts'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Bar = { open: boolean; sections: { lines: { text: string; kind?: string }[] }[]; cleared: number }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ lines: s.lines })
    return { value: bar.open }
  })
  on('sidebar.clear', () => { bar.cleared += 1; return { value: undefined } })
}

const run = (args: string): CommandRunInput => ({
  command: 'subagent-ledger', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'claude-fable-5-1', ...over,
})

let turns = 0
const turn = (over: { agentId?: string; usage?: TurnUsage; durationMs?: number } = {}): TurnCompleteInput => ({
  answer: 'done', durationMs: 1000, isAborted: false, turnId: `t${++turns}`, reason: 'answer', usage: usage(), ...over,
})

/** The status lines the mod wrote, newest last. */
type World = { statuses: (string | undefined)[] }

function world(on: On): World {
  const w: World = { statuses: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('agent.spawn', (_, e) => ({ model: 'claude-fable-5-1', agentId: `a-${e.subagentType}` }))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
}

/**
 * One spawn of a named agent type, which answers with the agent id the test then raises turns for. The
 * engine fills the pinned fields of a real spawn; a test raises the event, so it sends them itself.
 */
async function spawn($: Engine, subagentType: string, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `u-${subagentType}`,
    prompt: 'do it',
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-fable-5-1',
    background: false,
    fork: false,
  })
}

describe('subagent-ledger', () => {
  test('reads the tokens, the texts and the limit', () => {
    expect(tokensOf(usage())).toBe(10_000)
    expect(tokensOf(undefined)).toBe(0)
    expect(fmtTok(81_000)).toBe('81k')
    expect(fmtTok(1_500_000)).toBe('1.5M')
    expect(fmtDuration(42_000)).toBe('42s')
    expect(fmtDuration(130_000)).toBe('2m 10s')
    expect(rowText({ type: 'Explore', description: 'find the parser', model: 'claude-haiku-4-5-20251001', turns: 3, ms: 42_000, tokens: 81_000 }))
      .toBe('Explore: find the parser · haiku-4-5 · 3 turn · 42s · 81k')
    expect(shortModel('claude-fable-5-1')).toBe('fable-5-1')
    expect(shortModel('gpt-x')).toBe('gpt-x')
    expect(totalText([])).toBe(undefined)
    for (const bad of ['0', '10001', 'lots', '']) expect(limitOf(bad), bad).toBe(undefined)
    expect(limitOf('200')).toBe(200)
  })

  test('the pane draws five rows and counts the rest, red past the limit', () => {
    const runs = Array.from({ length: 7 }, (_, i) => ({ type: 'Explore', description: `${i}`, model: '', turns: 1, ms: 1000, tokens: (i + 1) * 50_000 }))
    const lines = sidebarLines(runs, 200)
    expect(lines).toHaveLength(6)
    expect(lines[0]?.kind).toBe('error')
    // The fourth row spent exactly the limit, so it is red too; the fifth is under it.
    expect(lines[3]?.kind).toBe('error')
    expect(lines[4]?.kind).toBe('ok')
    expect(lines[5]).toEqual({ text: '2 more · 150k', kind: 'dim' })
  })

  test('a subagent turn is counted, a main-loop turn is not', async ($, on) => {
    const w = world(on)
    await started($)
    await spawn($, 'Explore', 'find the parser')
    await $.turn.complete(turn({ agentId: 'a-Explore' }))
    await $.turn.complete(turn({ agentId: 'a-Explore', durationMs: 2000 }))
    await $.turn.complete(turn())
    expect(w.statuses.at(-1)).toBe('1 subagent · 2 turn · 3s · 20k')
    const text = (await $.command.run(run(''))).text
    expect(text).toContain('on · limit 200k · 1 subagent · 2 turn · 3s · 20k')
    expect(text).toContain('Explore: find the parser · fable-5-1 · 2 turn · 3s · 20k')
  })

  test('the limit the person sets holds, and off counts nothing', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number of thousands of tokens from 1 to 10000')
    expect((await $.command.run(run('limit 10'))).text).toBe('limit 10k: a subagent over 10k tokens is drawn red')
    expect((await $.command.run(run('off'))).text).toBe('off: subagents are not counted; the counts stay')
    await spawn($, 'Explore', 'x')
    await $.turn.complete(turn({ agentId: 'a-Explore' }))
    expect((await $.command.run(run(''))).text).toBe('off · limit 10k · no subagent ran yet')
    expect(w.statuses.at(-1)).toBe(undefined)
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on, off or limit <k>')
  })

  withSidebar('an open sidebar takes the ledger and the status line stays clear', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: 0 }
    seatSidebar(on, bar)
    await started($)
    await spawn($, 'Explore', 'find the parser')
    await $.turn.complete(turn({ agentId: 'a-Explore' }))
    expect(bar.sections.at(-1)?.lines).toEqual([{ text: 'Explore: find the parser · fable-5-1 · 1 turn · 1s · 10k', kind: 'ok' }])
    expect(w.statuses.at(-1)).toBe(undefined)
    await $.command.run(run('off'))
    expect(bar.cleared).toBe(1)
  })
})
