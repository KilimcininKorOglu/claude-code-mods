import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, PromptSubmitInput, TurnCompleteInput } from 'claude-code'

import { logText, noteText, pathsOf, statusText } from '../hooks/cadence.ts'

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

type Bar = { open: boolean; sections: { lines: { text: string; kind?: string }[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ lines: s.lines })
    return { value: bar.open }
  })
}

const run = (args: string): CommandRunInput => ({
  command: 'commit-cadence', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

let turns = 0
const turn = (over: { agentId?: string } = {}): TurnCompleteInput => ({
  answer: 'done', durationMs: 1000, isAborted: false, turnId: `t${++turns}`, reason: 'answer', ...over,
})

const prompt = (): PromptSubmitInput => ({ text: 'devam', origin: { kind: 'composer' }, wait: false })

/** The logged lines, and what `git status` answers in this world. */
type World = { logs: string[]; status: string; exitCode: number; contexts: (readonly string[] | undefined)[] }

function world(on: On): World {
  const w: World = { logs: [], status: '', exitCode: 0, contexts: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('prompt.submit', (_, e) => { w.contexts.push(e.context); return { text: e.text } })
  on('process.run', () => ({ value: { exitCode: w.exitCode, stdout: w.status, stderr: '' } }))
  return w
}

const started = ($: Engine): Promise<unknown> => $.session.start({ surface: null, isInteractive: true, cwd: '/work' })

/** What `git status --porcelain=v1 -z` writes for two changed files. */
const DIRTY = ' M src/app.ts\0?? src/new.ts\0'

describe('commit-cadence', () => {
  test('reads the porcelain records and the texts', () => {
    expect(pathsOf(DIRTY)).toEqual(['src/app.ts', 'src/new.ts'])
    expect(pathsOf('R  new.ts\0old.ts\0 M a.ts\0')).toEqual(['a.ts', 'new.ts'])
    expect(pathsOf('!! target/\0?? .claude/types/x.d.ts\0')).toEqual([])
    expect(pathsOf('')).toEqual([])
    expect(logText(['a.ts', 'b.ts'])).toBe('2 uncommitted file(s): a.ts, b.ts')
    expect(logText(['1', '2', '3', '4', '5', '6', '7'])).toBe('7 uncommitted file(s): 1, 2, 3, 4, 5, 6 and 1 more')
    expect(noteText(['a.ts'])).toContain('one commit per change')
    expect(statusText(true, [])).toBe('on · the working tree is clean')
    expect(statusText(true, undefined)).toBe('on · no git repository was read here')
  })

  test('a dirty tree is reported once, and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    await started($)
    w.status = DIRTY
    await $.turn.complete(turn())
    expect(w.logs).toEqual(['2 uncommitted file(s): src/app.ts, src/new.ts'])
    // The same set of paths says nothing a second time.
    await $.turn.complete(turn())
    expect(w.logs).toHaveLength(1)
    await $.prompt.submit(prompt())
    expect(w.contexts.at(-1)?.[0]).toContain('the working tree holds 2 uncommitted file(s)')
    // The note is owed once per report.
    await $.prompt.submit(prompt())
    expect(w.contexts.at(-1)).toBe(undefined)
  })

  test('a clean tree closes the finding, and a subagent turn measures nothing', async ($, on) => {
    const w = world(on)
    await started($)
    w.status = DIRTY
    await $.turn.complete(turn())
    w.status = ''
    await $.turn.complete(turn())
    expect(w.logs.at(-1)).toBe('the working tree is clean again')
    w.status = DIRTY
    await $.turn.complete(turn({ agentId: 'a1' }))
    expect(w.logs).toHaveLength(2)
  })

  test('no repository and off both measure nothing', async ($, on) => {
    const w = world(on)
    await started($)
    w.exitCode = 128
    await $.turn.complete(turn())
    expect((await $.command.run(run(''))).text).toBe('on · no git repository was read here')
    expect(w.logs).toEqual([])
    w.exitCode = 0
    w.status = DIRTY
    expect((await $.command.run(run('off'))).text).toBe('off: the tree is not measured')
    await $.turn.complete(turn())
    expect(w.logs).toEqual([])
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on or off')
  })

  withSidebar('an open sidebar takes the finding and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    w.status = DIRTY
    await $.turn.complete(turn())
    expect(bar.sections.at(-1)?.lines).toEqual([{ text: '2 uncommitted file(s): src/app.ts, src/new.ts', kind: 'error' }])
    w.status = ''
    await $.turn.complete(turn())
    expect(bar.sections.at(-1)?.lines).toEqual([{ text: 'the working tree is clean again', kind: 'ok' }])
    expect(w.logs).toEqual([])
  })
})
