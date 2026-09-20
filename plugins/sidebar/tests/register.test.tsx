import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf, UiPane } from 'claude-code'

import { EMPTY_TEXT } from '../hooks/board.ts'

tier('user')

const ROOT = '/Users/u/app'

const PANE_ID = 'sidebar'

const run = (args: string): CommandRunInput => ({
  command: 'sidebar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
})

const PANE = { title: 'Sidebar', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['Pane']

/** The store as a record the test can read back, and the panes the plugin opened. */
type World = { store: Record<string, unknown>; panes: UiPane[] }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { store, panes: [] }
  mock.clock(on, { now: Date.parse('2026-09-20T10:00:00Z') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_, e) => { delete w.store[e.key]; return { value: undefined } })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_, e) => { w.panes = [...w.panes, { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]; return { value: undefined } })
  on('ui.close', (_, e) => { w.panes = w.panes.filter(p => p.id !== e.id); return { value: undefined } })
  return w
}

const started = ($: Engine) => $.session.start({ surface: null, isInteractive: true, cwd: ROOT })

describe('sidebar', () => {
  test('the command opens and closes the pane and keeps the choice', async ($, on) => {
    const w = world(on)
    await started($)
    expect(w.panes).toEqual([])
    expect((await $.command.run(run(''))).text).toContain('on:')
    expect(w.panes.map(p => p.id)).toEqual([PANE_ID])
    expect(w.store.open).toBe(true)
    expect((await $.command.run(run('status'))).text).toBe('on, 0 section(s)')
    expect((await $.command.run(run('off'))).text).toContain('off:')
    expect(w.panes).toEqual([])
    expect(w.store.open).toBe(false)
    expect((await $.command.run(run('what'))).text).toContain('expects nothing')
  })

  test('a session with the choice stored opens the pane by itself', async ($, on) => {
    const w = world(on, { open: true })
    await started($)
    expect(w.panes.map(p => p.id)).toEqual([PANE_ID])
    expect((await $.command.run(run('status'))).text).toBe('on, 0 section(s)')
  })

  // The test engine raises no `ui.close`, so the person's close is measured in a live session.
  test('an empty pane says so', async ($, on) => {
    world(on, { open: true })
    await started($)
    const pane = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE })
    expect(await pane.find({ text: EMPTY_TEXT })).toBeDefined()
  })
})
