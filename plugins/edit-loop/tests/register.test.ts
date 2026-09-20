import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { countEdit, sectionKey, shownPath, THRESHOLD, WARN_THRESHOLD } from '../hooks/loop.ts'

tier('user')

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'edit-loop', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const NOTE = 'edit-loop: this turn edited hooks/a.ts 5 times. Stop editing it, re-read the code path and state the root cause before the next edit.'

/** `fail` makes the next edit fail beneath the plugin; `logs` holds the lines the person sees. */
type World = { fail: boolean; logs: string[] }

function world(on: On): World {
  const w: World = { fail: false, logs: [] }
  mock.store(on, {})
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const answer = () => (w.fail ? { result: 'Error', text: 'String not found', isError: true } : { result: 'ok' }) as never
  on('tool.call', { tool: 'Edit' }, answer)
  on('tool.call', { tool: 'Write' }, answer)
  on('tool.call', { tool: 'NotebookEdit' }, answer)
  return w
}

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Bar = { open: boolean; sections: { key: string; title: string; lines: { text: string; kind?: string }[]; until: string }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string; kind?: string }[]; until: string }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => ({ text: l.text, kind: l.kind })), until: s.until })
    return { value: bar.open }
  })
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
}

const edit = ($: Engine, path = `${ROOT}/hooks/a.ts`, agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId === undefined ? {} : { agentId }) } as never)

describe('loop', () => {
  test('counts each loop and file apart', async () => {
    const counts = new Map<string, number>()
    const hits = Array.from({ length: 7 }, () => countEdit(counts, undefined, '/a'))
    expect(hits).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(hits.indexOf(WARN_THRESHOLD)).toBe(WARN_THRESHOLD - 1)
    expect(hits.indexOf(THRESHOLD)).toBe(THRESHOLD - 1)
    expect(countEdit(counts, 'agent-1', '/a')).toBe(1)
    expect(shownPath('/Users/u/app/src/x.ts', '/Users/u/app/')).toBe('src/x.ts')
    expect(shownPath('/tmp/x.ts', '/Users/u/app')).toBe('/tmp/x.ts')
  })

  test('a section key keeps the letters the sidebar takes', () => {
    expect(sectionKey('hooks/a.ts')).toBe('hooks-a.ts')
    expect(sectionKey('')).toBe('note')
    expect(sectionKey('x'.repeat(80))).toHaveLength(64)
  })
})

describe('edit-loop', () => {
  test('the fifth edit of one file in a turn gets the note, once, and the third warns the person alone', async ($, on) => {
    const w = world(on)
    await started($)
    const results = []
    for (let i = 0; i < 6; i++) results.push(await edit($))
    expect(results.map(r => r.context)).toEqual([undefined, undefined, undefined, undefined, [NOTE], undefined])
    expect(w.logs).toEqual(['3rd edit of hooks/a.ts in this turn', '5th edit of hooks/a.ts in this turn'])
  })

  test('Write and NotebookEdit count, a failed edit does not, and a new turn starts again', async ($, on) => {
    const w = world(on)
    await started($)
    await edit($)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/hooks/a.ts`, content: 'x' } as never)
    w.fail = true
    await edit($)
    w.fail = false
    await edit($)
    await edit($)
    expect((await edit($)).context).toEqual([NOTE])
    await $.turn.start({ text: 'again', turnId: 't2' } as never)
    for (let i = 0; i < 4; i++) expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${ROOT}/n.ipynb`, new_source: 'x' } as never)).context).toBe(undefined)
    expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${ROOT}/n.ipynb`, new_source: 'x' } as never)).context?.[0]).toContain('edited n.ipynb 5 times')
  })

  withSidebar('an open sidebar takes the yellow warning and the red finding, and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    for (let i = 0; i < 5; i++) await edit($)
    expect(bar.sections).toEqual([
      { key: 'hooks-a.ts', title: 'edits piling up', lines: [{ text: '3rd edit of hooks/a.ts in this turn', kind: 'warn' }], until: 'stream' },
      { key: 'hooks-a.ts', title: 'edit loop', lines: [{ text: '5th edit of hooks/a.ts in this turn', kind: 'error' }], until: 'stream' },
    ])
    expect(w.logs).toEqual([])
  })

  withSidebar('a closed sidebar leaves the transcript line as it was', async ($, on) => {
    const w = world(on)
    seatSidebar(on, { open: false, sections: [] })
    await started($)
    for (let i = 0; i < 5; i++) await edit($)
    expect(w.logs).toEqual(['3rd edit of hooks/a.ts in this turn', '5th edit of hooks/a.ts in this turn'])
  })

  test('a subagent counts apart from the main loop, and off counts nothing', async ($, on) => {
    world(on)
    await started($)
    for (let i = 0; i < 4; i++) await edit($)
    expect((await edit($, `${ROOT}/hooks/a.ts`, 'agent-1')).context).toBe(undefined)
    expect((await $.command.run(run('off'))).text).toBe('off: edits are not counted')
    expect((await edit($)).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })
})
