import { describe, expect, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, PromptSubmitInput, TurnCompleteInput } from 'claude-code'

import { logText, noteText, openOf, pathsOf, statusText } from '../hooks/cadence.ts'

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

type Bar = { open: boolean; sections: { lines: { text: string; kind?: string }[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ lines: s.lines })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    bar.cleared.push((e as unknown as { key: string }).key)
    return { value: undefined }
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

/** `store` is what an earlier module of the same repository left in `$.store`. */
function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { logs: [], status: '', exitCode: 0, contexts: [] }
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_, e) => { delete store[e.key]; return { value: undefined } })
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
    // An old path of three characters or less is still spent, so the entry after it is not skipped.
    expect(pathsOf('R  src/new.c\0a.c\0 M src/app.ts\0')).toEqual(['src/app.ts', 'src/new.c'])
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
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    w.status = DIRTY
    await $.turn.complete(turn())
    expect(bar.sections.at(-1)?.lines).toEqual([{ text: '2 uncommitted file(s): src/app.ts, src/new.ts', kind: 'error' }])
    w.status = ' M src/app.ts\0'
    await $.turn.complete(turn())
    expect(bar.cleared).toEqual([])
    w.status = ''
    await $.turn.complete(turn())
    // The clean tree drops every red entry it wrote, so a pane restore does not bring them back.
    expect(bar.cleared.sort()).toEqual(['dirty-1', 'dirty-2'])
    expect(bar.sections.at(-1)?.lines).toEqual([{ text: 'the working tree is clean again', kind: 'ok' }])
    expect(w.logs).toEqual([])
  })

  withSidebar('a module loaded again closes the finding the one before it reported, once the tree is clean', async ($, on) => {
    // /reload-plugins after a report: the new module starts with the stored finding (measured on a live session).
    const w = world(on, { 'open:/work': { paths: ['src/app.ts', 'src/new.ts'], keys: ['dirty-2'] } })
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    w.status = DIRTY
    await $.turn.complete(turn())
    // The same paths are not reported again, and the model is not told again.
    expect(bar.sections).toEqual([])
    await $.prompt.submit(prompt())
    expect(w.contexts.at(-1)).toBe(undefined)
    w.status = ''
    await $.turn.complete(turn())
    expect(bar.cleared).toEqual(['dirty-2'])
    expect(bar.sections.at(-1)?.lines).toEqual([{ text: 'the working tree is clean again', kind: 'ok' }])
  })

  test('the finding is stored while it stands and removed once the tree is clean', async ($, on) => {
    const store: Record<string, unknown> = {}
    const w = world(on, store)
    await started($)
    w.status = DIRTY
    await $.turn.complete(turn())
    expect(store['open:/work']).toEqual({ paths: ['src/app.ts', 'src/new.ts'], keys: ['dirty-2'] })
    w.status = ''
    await $.turn.complete(turn())
    expect(store['open:/work']).toBe(undefined)
    // A stored value of another shape is not trusted.
    expect(openOf({ paths: 'a', keys: [] })).toBe(undefined)
  })
})
