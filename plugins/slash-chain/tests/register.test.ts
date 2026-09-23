import { describe, expect, mock, test, tier, type Engine, type Plugin } from 'claude-code/testing'
import type { CommandRunInput, On, PromptOrigin, TurnCompleteInput } from 'claude-code'

tier('user')

/**
 * The engine's commands: `tiny` hands the model a prompt as a prompt command does, `boom` throws,
 * every other one answers at once as a local command does.
 */
type World = { ran: string[]; logs: string[] }

function world($: Engine, on: On): { w: World; clock: ReturnType<typeof mock.clock> } {
  const w: World = { ran: [], logs: [] }
  mock.store(on, {})
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('command.run', async (_, e) => {
    w.ran.push(e.args === '' ? e.command : `${e.command} ${e.args}`)
    if (e.command === 'boom') throw new Error('no such command')
    if (e.command === 'tiny') await $.skill.prompt({ skill: 'tiny', text: 'answer in one word' })
    return {}
  })
  return { w, clock }
}

/** Another plugin's commands: `pane` opens a focused pane, `shut <id>` closes one, as the person's Esc does. */
const OPENER: Plugin = {
  name: 'opener',
  register(on) {
    on('command.run', { command: 'pane' }, async ($) => { await $.ui.open({ id: 'picker', focus: true, closeOnEscape: true }); return {} })
    on('command.run', { command: 'shut' }, async ($, e) => { await $.ui.close({ id: e.args }); return {} })
  },
}

const typed = (command: string, args: string, kind = 'composer'): CommandRunInput => ({ command, args, origin: { kind } as PromptOrigin, presentation: { isFullscreen: false, columns: 80 } })

let turns = 0
const turn = (reason: 'answer' | 'aborted' | 'error', agentId?: string): TurnCompleteInput => ({ answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId: `t${++turns}`, reason, ...(agentId === undefined ? {} : { agentId }) })

const started = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

/** Lets the step timers run and the commands they start finish. */
async function settle(clock: ReturnType<typeof mock.clock>): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(10)
    for (let j = 0; j < 50; j += 1) await Promise.resolve()
  }
}

describe('slash-chain', () => {
  test('local commands run one after another, each with its own arguments', async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    await $.command.run(typed('context', '&& /cost && /review src'))
    await settle(clock)
    expect(w.ran).toEqual(['context', 'cost', 'review src'])
    expect(w.logs).toEqual(['1/3: /context', '2/3: /cost', '3/3: /review src', 'all 3 command(s) ran'])
  })

  test('a command that throws stops the chain and names what did not run', async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    await $.command.run(typed('context', '&& /boom && /cost'))
    await settle(clock)
    expect(w.ran).toEqual(['context', 'boom'])
    // The test engine reports a world hook's throw as `no implementation`; a live one carries the command's own message.
    expect(w.logs.at(-1)).toMatch(/^stopped after \/boom: it failed: .+; not run: \/cost$/)
  })

  test('a prompt command waits for its turn: an answer runs the next one, a subagent\'s end does not', async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    await $.command.run(typed('tiny', 'x && /context'))
    await settle(clock)
    expect(w.ran).toEqual(['tiny x'])
    expect((await $.command.run(typed('slash-chain', ''))).text).toBe('on · 1/2 /tiny x, waiting for its turn')
    await $.turn.complete(turn('answer', 'agent-1'))
    await settle(clock)
    expect(w.ran).toEqual(['tiny x'])
    await $.turn.complete(turn('answer'))
    await settle(clock)
    expect(w.ran).toEqual(['tiny x', 'context'])
    expect(w.logs.at(-1)).toBe('all 2 command(s) ran')
  })

  test('a turn that ends without an answer stops the chain', async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    await $.command.run(typed('context', '&& /tiny && /cost'))
    await settle(clock)
    expect(w.ran).toEqual(['context', 'tiny'])
    await $.turn.complete(turn('aborted'))
    await settle(clock)
    expect(w.ran).toEqual(['context', 'tiny'])
    expect(w.logs.at(-1)).toBe('stopped after /tiny: its turn ended with aborted; not run: /cost')
  })

  test('a command that opens a focused pane waits for that pane to close', { plugins: [OPENER] }, async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    await $.command.run(typed('pane', '&& /context'))
    await settle(clock)
    expect(w.ran).toEqual([])
    await $.command.run(typed('shut', 'other', 'plugin'))
    await settle(clock)
    expect(w.ran).toEqual([])
    await $.command.run(typed('shut', 'picker', 'plugin'))
    await settle(clock)
    expect(w.ran).toEqual(['context'])
    expect(w.logs.at(-1)).toBe('all 2 command(s) ran')
  })

  test('the person\'s own prompt cancels a waiting chain, and the step\'s own submit does not', async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    await $.command.run(typed('tiny', '&& /context'))
    await $.prompt.submit({ text: '/tiny', origin: { kind: 'composer' } as PromptOrigin, wait: false })
    expect(w.logs).toEqual(['1/2: /tiny'])
    await $.prompt.submit({ text: 'something else', origin: { kind: 'composer' } as PromptOrigin, wait: false })
    expect(w.logs.at(-1)).toBe('cancelled; not run: /context')
    await $.turn.complete(turn('answer'))
    await settle(clock)
    expect(w.ran).toEqual(['tiny'])
  })

  test('off leaves the command as the engine handed it', async ($, on) => {
    const { w, clock } = world($, on)
    await started($)
    expect((await $.command.run(typed('slash-chain', 'off'))).text).toBe('off: the engine runs the first command alone, as it does without the mod')
    await $.command.run(typed('context', '&& /cost'))
    await settle(clock)
    expect(w.ran).toEqual(['context && /cost'])
    expect(w.logs).toEqual([])
    expect((await $.command.run(typed('slash-chain', 'x'))).text).toBe('expects nothing (the status), stop, on or off')
    expect((await $.command.run(typed('slash-chain', 'stop'))).text).toBe('no chain runs')
  })
})
