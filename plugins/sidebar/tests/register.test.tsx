import { describe, expect, mock, test, tier, type Engine, type Plugin } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf, UiPane } from 'claude-code'

import { EMPTY_TEXT } from '../hooks/board.ts'

tier('user')

const ROOT = '/Users/u/app'

const PANE_ID = 'sidebar'

const run = (args: string): CommandRunInput => ({
  command: 'sidebar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
})

const PANE = { title: 'Sidebar', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['Pane']

/** Where the logs live for the home this world answers with. */
const LOG_DIR = '/Users/u/.claude/sidebar'

/** Two local times, one per day, so a restored entry's own stamp is readable. */
const OLD = new Date(2026, 8, 19, 13, 0).getTime()
const NOW = new Date(2026, 8, 20, 13, 0).getTime()

/** One line of a log file, as the mod writes it. */
const LINE = (consumer: string, title: string, at: number) =>
  JSON.stringify({ at, consumer, key: 'note', title, lines: [{ text: 'a finding', kind: 'error' }] })

/** The store as a record the test can read back, the panes the plugin opened, and the log files. */
type World = { store: Record<string, unknown>; panes: UiPane[]; files: Map<string, string>; now: number }

function world(on: On, store: Record<string, unknown> = {}, files: Map<string, string> = new Map()): World {
  const w: World = { store, panes: [], files, now: Date.parse('2026-09-20T10:00:00Z') }
  on('clock.now', () => ({ value: w.now }))
  mock.env(on, { HOME: '/Users/u' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => { w.files.set(e.path, e.text); return { value: undefined } })
  on('fs.list', (_, e) => ({
    value: [...w.files.keys()]
      .filter(p => p.startsWith(`${e.path}/`))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 0, isLink: false })),
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_, e) => { delete w.store[e.key]; return { value: undefined } })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_, e) => { w.panes = [...w.panes, { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]; return { value: { isPlaced: true as const } } })
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
    expect((await $.command.run(run('status'))).text).toBe('on, 0 section(s), 0 in the stream')
    expect((await $.command.run(run('off'))).text).toContain('off:')
    expect(w.panes).toEqual([])
    expect(w.store.open).toBe(false)
    expect((await $.command.run(run('what'))).text).toContain('expects nothing')
  })

  test('a session with the choice stored opens the pane by itself', async ($, on) => {
    const w = world(on, { open: true })
    await started($)
    expect(w.panes.map(p => p.id)).toEqual([PANE_ID])
    expect((await $.command.run(run('status'))).text).toBe('on, 0 section(s), 0 in the stream')
  })

  /**
   * A plugin loaded after the sidebar: it logs what the sidebar says at the end of its own session start.
   * An inline plugin runs apart from the test file, so it answers through a log line.
   */
  const LATER: Plugin = {
    name: 'later',
    register(on) {
      on('session.start', async ($, e, next) => {
        const r = await next(e)
        $.ui.log(String((await $.command.run({ command: 'sidebar', args: 'status' })).text))
        return r
      })
    },
  }

  test('a plugin loaded after the sidebar finds it open during its own session start', { plugins: [LATER] }, async ($, on) => {
    const w = world(on, { open: true })
    const heard: string[] = []
    on('ui.log', (_, e) => { heard.push(e.text); return { value: undefined } })
    await started($)
    expect(heard).toEqual(['on, 0 section(s), 0 in the stream'])
    expect(w.panes.map(p => p.id)).toEqual([PANE_ID])
  })

  test('a session that runs past midnight reads the new day\'s log', async ($, on) => {
    const w = world(on, {}, new Map([[`${LOG_DIR}/app-2026-09-21.log`, `${LINE('env-sync', 'after midnight', NOW)}\n`]]))
    await started($)
    expect((await $.command.run(run('log'))).text).toBe(`${LOG_DIR}/app-2026-09-20.log: no entry yet`)
    w.now = new Date(2026, 8, 21, 0, 30).getTime()
    expect((await $.command.run(run('log'))).text).toContain(`${LOG_DIR}/app-2026-09-21.log`)
  })

  test("an open pane takes this project's newest log entries back into the stream", async ($, on) => {
    // Two days of this project's log, and another project's file the restore must leave alone.
    const files = new Map([
      [`${LOG_DIR}/app-2026-09-19.log`, `${LINE('edit-loop', 'yesterday', OLD)}\n`],
      [`${LOG_DIR}/app-2026-09-20.log`, `${LINE('env-sync', 'today', NOW)}\n`],
      [`${LOG_DIR}/other-2026-09-20.log`, `${LINE('env-sync', 'another project', NOW)}\n`],
    ])
    world(on, { open: true }, files)
    await started($)
    expect((await $.command.run(run('status'))).text).toBe('on, 0 section(s), 2 in the stream')
    const log = (await $.command.run(run('log'))).text ?? ''
    expect(log).toContain(`${LOG_DIR}/app-2026-09-20.log`)
    expect(log).toContain('20.09 13:00 env-sync: today')
    expect(log).not.toContain('another project')
    const pane = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE })
    // The restored entry keeps the day and time it was first written, not this session's.
    expect(await pane.find({ text: 'edit-loop: yesterday (19.09 13:00)' })).toBeDefined()
  })

  test('a restore leaves out an entry a later clear took down, also one a newer day cleared', async ($, on) => {
    // Yesterday's finding closed today: the clear line sits in the newer file, the finding in the older.
    const cleared = JSON.stringify({ at: NOW, cleared: { consumer: 'i18n-watch', key: 'note' } })
    const files = new Map([
      [`${LOG_DIR}/app-2026-09-19.log`, `${LINE('i18n-watch', 'missing translation keys', OLD)}\n`],
      [`${LOG_DIR}/app-2026-09-20.log`, `${cleared}\n${LINE('i18n-watch', 'translation keys added', NOW)}\n`],
    ])
    world(on, { open: true }, files)
    await started($)
    expect((await $.command.run(run('status'))).text).toBe('on, 0 section(s), 1 in the stream')
    const pane = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE })
    expect(await pane.find({ text: 'i18n-watch: translation keys added (20.09 13:00)' })).toBeDefined()
    // The log command still reads the whole history.
    expect((await $.command.run(run('log'))).text).toContain('20.09 13:00 i18n-watch: translation keys added')
  })

  // The test engine raises no `ui.close`, so the person's close is measured in a live session.
  test('an empty pane says so', async ($, on) => {
    world(on, { open: true })
    await started($)
    const pane = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE })
    expect(await pane.find({ text: EMPTY_TEXT })).toBeDefined()
  })
})
