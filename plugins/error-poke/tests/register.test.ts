import { describe, expect, mock, test, tier, type Engine, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { DEFAULT_MAX_POKES, decide, limitOf, MAX_DELAY_MS, POKE_TEXT, pokeDelay, pokeLog, statusText } from '../hooks/poke.ts'

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

type Bar = { open: boolean; sections: { key: string; title: string; lines: string[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
}

const run = (args: string): CommandRunInput => ({
  command: 'error-poke', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/**
 * The prompts that reached the engine (through the mod's `send` command, or submitted), how many went
 * through `send`, the logged lines, `sendFails` to make the engine refuse that command, `drop` to make it
 * refuse a submitted prompt, and the clock.
 */
type World = { sent: string[]; sends: number; logs: string[]; sendFails?: true; drop?: string; clock: MockClock }

function world(on: On): World {
  const w: World = { sent: [], sends: 0, logs: [], clock: mock.clock(on) }
  on('command.run', { command: 'error-poke:send' }, (_, e) => {
    if (w.sendFails === true) throw new Error('unknown command')
    w.sent.push(e.args)
    w.sends += 1
    return {}
  })
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('prompt.submit', (_, e) => {
    w.sent.push(e.text)
    return w.drop === undefined ? { text: e.text } : { drop: w.drop }
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/Users/u/app' })
}

/**
 * One main-loop turn that ended with `reason`. A refused turn needs a refusal payload and no test drives
 * one; `decide` covers that case.
 */
async function ended($: Engine, w: World, reason: 'answer' | 'aborted' | 'error', turnId = 't1'): Promise<void> {
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: reason === 'aborted', turnId, reason })
  // The continue prompt waits on a timer, and is submitted without awaiting it; moving the clock past
  // the longest wait lets it and its answer run.
  await w.clock.advance(MAX_DELAY_MS)
}

describe('error-poke', () => {
  test('only an API error asks for a continue prompt', () => {
    expect(decide('error', 0, DEFAULT_MAX_POKES)).toBe('poke')
    expect(decide('error', DEFAULT_MAX_POKES, DEFAULT_MAX_POKES)).toBe('limit')
    for (const reason of ['answer', 'aborted', 'refusal']) expect(decide(reason, 0, DEFAULT_MAX_POKES), reason).toBe('idle')
    expect(statusText(true, 2, DEFAULT_MAX_POKES, 'error')).toBe('on · 2/99 continue prompts since your last prompt · last turn: error')
    expect(statusText(false, 0, DEFAULT_MAX_POKES, undefined)).toBe('off · 0/99 continue prompts since your last prompt · no turn has ended yet')
  })

  test('a turn killed by an API error gets one continue prompt, and the person reads one line', async ($, on) => {
    const w = world(on)
    await started($)
    await ended($, w, 'error')
    expect(w.sent).toEqual([POKE_TEXT])
    expect(w.sends).toBe(1)
    expect(w.logs).toEqual(['the turn died on an API error, continuing in 5 s (1/99)'])
    expect((await $.command.run(run(''))).text).toBe('on · 1/99 continue prompts since your last prompt · last turn: error')
  })

  test('each continue prompt waits longer than the last, and a prompt of the person cancels the wait', async ($, on) => {
    expect([1, 2, 3, 4, 5, 6].map(pokeDelay)).toEqual([5_000, 15_000, 45_000, 135_000, 300_000, 300_000])
    expect(pokeLog(4, 99)).toBe('the turn died on an API error, continuing in 2 min (4/99)')
    const w = world(on)
    await started($)
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'error' })
    await w.clock.advance(4_999)
    expect(w.sent).toEqual([])
    await w.clock.advance(1)
    expect(w.sent).toEqual([POKE_TEXT])
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't2', reason: 'error' })
    await w.clock.advance(5_000)
    expect(w.sent).toHaveLength(1)
    // The person speaks during the second wait: the count resets and the waiting prompt never goes out.
    await $.prompt.submit({ text: 'I will take it from here', wait: false, origin: { kind: 'composer' } })
    await w.clock.advance(MAX_DELAY_MS)
    expect(w.sent).toEqual([POKE_TEXT, 'I will take it from here'])
  })

  test('an answered or interrupted turn sends nothing', async ($, on) => {
    const w = world(on)
    await started($)
    await ended($, w, 'answer')
    await ended($, w, 'aborted', 't2')
    expect(w.sent).toEqual([])
    expect(w.logs).toEqual([])
    expect((await $.command.run(run(''))).text).toContain('last turn: aborted')
  })

  test('the prompts stop at the limit, say so once, and a prompt of the person resets the count', async ($, on) => {
    const w = world(on)
    await started($)
    for (let i = 0; i < DEFAULT_MAX_POKES + 2; i++) await ended($, w, 'error', `t${i}`)
    expect(w.sent).toHaveLength(DEFAULT_MAX_POKES)
    expect(w.logs.filter(l => l.startsWith('stopped after'))).toEqual([
      'stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.',
    ])
    await $.prompt.submit({ text: 'go on then', wait: false, origin: { kind: 'composer' } })
    expect((await $.command.run(run(''))).text).toContain('0/99 continue prompts')
    await ended($, w, 'error', 'again')
    expect(w.sent).toHaveLength(DEFAULT_MAX_POKES + 2)
  })

  test('off sends nothing, and on sends again', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('off'))).text).toContain('off · 0/99')
    await ended($, w, 'error')
    expect(w.sent).toEqual([])
    await $.command.run(run('on'))
    await ended($, w, 'error', 't2')
    expect(w.sent).toEqual([POKE_TEXT])
  })

  test('the limit the person sets holds, and an argument it cannot read changes nothing', async ($, on) => {
    const w = world(on)
    await started($)
    for (const bad of ['0', '1000', 'many', '']) expect(limitOf(bad), bad).toBe(undefined)
    expect(limitOf('2')).toBe(2)
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number from 1 to 999')
    expect((await $.command.run(run('limit 2'))).text).toBe('limit 2: at most 2 continue prompt(s) go out for one stretch of failures')
    for (let i = 0; i < 4; i++) await ended($, w, 'error', `t${i}`)
    expect(w.sent).toHaveLength(2)
    expect(w.logs.at(-1)).toBe('stopped after 2 continue prompts; the API keeps failing. Send a prompt to reset the count.')
    expect((await $.command.run(run(''))).text).toContain('2/2 continue prompts')
  })

  test('a send command the engine refuses goes out as a plugin prompt, and a dropped one is reported', async ($, on) => {
    const w = world(on)
    w.sendFails = true
    w.drop = 'the session is busy'
    await started($)
    await ended($, w, 'error')
    expect(w.sends).toBe(0)
    expect(w.sent).toEqual([POKE_TEXT])
    expect(w.logs.slice(1)).toEqual([
      'the send command did not run, the continue prompt goes out as a plugin prompt: HooksError: no implementation for command.run',
      'the continue prompt was dropped: the session is busy',
    ])
  })

  withSidebar('an open sidebar takes the lines and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    await ended($, w, 'error')
    expect(bar.sections).toEqual([{ key: 'poke-1', title: 'turn continued after an API error', lines: ['the turn died on an API error, continuing in 5 s (1/99)'] }])
    expect(w.logs).toEqual([])
  })
})
