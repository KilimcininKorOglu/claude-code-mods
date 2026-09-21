import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { DEFAULT_MAX_POKES, decide, limitOf, POKE_TEXT, statusText } from '../hooks/poke.ts'

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

/** The prompts the mod submitted, the logged lines, and `drop` to make the engine refuse one. */
type World = { sent: string[]; logs: string[]; drop?: string }

function world(on: On): World {
  const w: World = { sent: [], logs: [] }
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

/** A plugin prompt is submitted without awaiting it, so a test lets the microtasks run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

/**
 * One main-loop turn that ended with `reason`. A refused turn needs a refusal payload and no test drives
 * one; `decide` covers that case.
 */
async function ended($: Engine, reason: 'answer' | 'aborted' | 'error', turnId = 't1'): Promise<void> {
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: reason === 'aborted', turnId, reason })
  await flush()
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
    await ended($, 'error')
    expect(w.sent).toEqual([POKE_TEXT])
    expect(w.logs).toEqual(['the turn died on an API error, continuing (1/99)'])
    expect((await $.command.run(run(''))).text).toBe('on · 1/99 continue prompts since your last prompt · last turn: error')
  })

  test('an answered or interrupted turn sends nothing', async ($, on) => {
    const w = world(on)
    await started($)
    await ended($, 'answer')
    await ended($, 'aborted', 't2')
    expect(w.sent).toEqual([])
    expect(w.logs).toEqual([])
    expect((await $.command.run(run(''))).text).toContain('last turn: aborted')
  })

  test('the prompts stop at the limit, say so once, and a prompt of the person resets the count', async ($, on) => {
    const w = world(on)
    await started($)
    for (let i = 0; i < DEFAULT_MAX_POKES + 2; i++) await ended($, 'error', `t${i}`)
    expect(w.sent).toHaveLength(DEFAULT_MAX_POKES)
    expect(w.logs.filter(l => l.startsWith('stopped after'))).toEqual([
      'stopped after 99 continue prompts; the API keeps failing. Send a prompt to reset the count.',
    ])
    await $.prompt.submit({ text: 'go on then', wait: false, origin: { kind: 'composer' } })
    expect((await $.command.run(run(''))).text).toContain('0/99 continue prompts')
    await ended($, 'error', 'again')
    expect(w.sent).toHaveLength(DEFAULT_MAX_POKES + 2)
  })

  test('off sends nothing, and on sends again', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('off'))).text).toContain('off · 0/99')
    await ended($, 'error')
    expect(w.sent).toEqual([])
    await $.command.run(run('on'))
    await ended($, 'error', 't2')
    expect(w.sent).toEqual([POKE_TEXT])
  })

  test('the limit the person sets holds, and an argument it cannot read changes nothing', async ($, on) => {
    const w = world(on)
    await started($)
    for (const bad of ['0', '1000', 'many', '']) expect(limitOf(bad), bad).toBe(undefined)
    expect(limitOf('2')).toBe(2)
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number from 1 to 999')
    expect((await $.command.run(run('limit 2'))).text).toBe('limit 2: at most 2 continue prompt(s) go out for one stretch of failures')
    for (let i = 0; i < 4; i++) await ended($, 'error', `t${i}`)
    expect(w.sent).toHaveLength(2)
    expect(w.logs.at(-1)).toBe('stopped after 2 continue prompts; the API keeps failing. Send a prompt to reset the count.')
    expect((await $.command.run(run(''))).text).toContain('2/2 continue prompts')
  })

  test('a dropped prompt is reported to the person', async ($, on) => {
    const w = world(on)
    w.drop = 'the session is busy'
    await started($)
    await ended($, 'error')
    expect(w.logs.at(-1)).toBe('the continue prompt was dropped: the session is busy')
  })

  withSidebar('an open sidebar takes the lines and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    await ended($, 'error')
    expect(bar.sections).toEqual([{ key: 'poke-1', title: 'turn continued after an API error', lines: ['the turn died on an API error, continuing (1/99)'] }])
    expect(w.logs).toEqual([])
  })
})
