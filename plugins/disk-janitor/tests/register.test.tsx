import { describe, expect, mock, test, tier, type Engine, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, FsEntry, On, PromptOrigin, RenderPropsOf, TurnCompleteInput, UiPane } from 'claude-code'

tier('user')

const ROOT = '/Users/u/app'
const GB = 1024 * 1024

const run = (args: string, origin: PromptOrigin = { kind: 'composer' }): CommandRunInput => ({
  command: 'disk-janitor', args, origin, presentation: { isFullscreen: true, columns: 120 },
})

const turn: TurnCompleteInput = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' }

const PANE = { title: 'Build artifacts', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['Pane']

/** A repository on a fake disk: directories with their entries, and the files that exist. */
type World = {
  clock: MockClock
  dirs: Map<string, FsEntry[]>
  files: Set<string>
  links: Set<string>
  ignored: string
  notIgnored: Set<string>
  sizes: Map<string, number>
  removed: string[]
  logs: string[]
  statuses: (string | undefined)[]
  panes: UiPane[]
  inGit: boolean
}

const dir = (name: string): FsEntry => ({ name, kind: 'dir', size: 0, isLink: false })

function processAnswer(w: World, argv: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
  if (argv[1] === 'rev-parse') return w.inGit ? ok(`${ROOT}\n`) : { exitCode: 128, stdout: '', stderr: 'not a git repository' }
  if (argv[1] === 'ls-files') return ok(w.ignored)
  if (argv[1] === 'check-ignore') return w.notIgnored.has(argv.at(-1) ?? '') ? { exitCode: 1, stdout: '', stderr: '' } : ok('')
  if (argv[0] === 'du') return ok(argv.slice(3).map(p => `${w.sizes.get(p) ?? 0}\t${p}`).join('\n'))
  if (argv[0] === 'rm') {
    const path = argv.at(-1) ?? ''
    w.removed.push(path)
    w.ignored = w.ignored.split('\0').filter(p => `${ROOT}/${p}` !== `${path}/`).join('\0')
    return ok('')
  }
  throw new Error(`unexpected command ${argv.join(' ')}`)
}

// Beneath the plugin: a repository with node_modules, target, dist, a data directory with a venv inside, and docs.
function world(on: On): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    dirs: new Map([[`${ROOT}/data`, [dir('venv'), dir('raw'), dir('models')]]]),
    files: new Set([`${ROOT}/node_modules/.package-lock.json`, `${ROOT}/target/CACHEDIR.TAG`, `${ROOT}/data/venv/pyvenv.cfg`]),
    links: new Set(),
    ignored: ['node_modules/', 'target/', 'dist/', 'data/', '.env', 'docs/'].join('\0'),
    notIgnored: new Set(),
    sizes: new Map([[`${ROOT}/node_modules`, 2 * GB], [`${ROOT}/target`, 4 * GB], [`${ROOT}/dist`, 1024], [`${ROOT}/data/venv`, 512 * 1024]]),
    removed: [],
    logs: [],
    statuses: [],
    panes: [],
    inGit: true,
  }
  mock.store(on, {})
  on('session.cwd', () => ({ value: ROOT }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => ({ value: processAnswer(w, e.argv) }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.list', (_, e) => ({ value: w.dirs.get(e.path ?? '') ?? [] }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: w.links.has(e.path), realPath: e.path } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_, e) => { w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: true, isPlaced: true }); return { value: { isPlaced: true as const } } })
  on('ui.close', (_, e) => { w.panes = w.panes.filter(p => p.id !== e.id); return { value: undefined } })
  return w
}

async function started($: Engine, w: World): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
  await w.clock.settle()
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

type Button = { label: string; command: string; args?: string }
type Drawn = { text: string; kind?: string; parts?: { text: string; kind?: string }[] }
type Bar = { open: boolean; sections: { key: string; lines: Drawn[]; buttons?: Button[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: Drawn[]; buttons?: Button[] }
    if (bar.open) bar.sections.push({ key: s.key, lines: s.lines, buttons: s.buttons })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    bar.cleared.push((e as unknown as { key: string }).key)
    return { value: undefined }
  })
  on('sidebar.isOpen', () => ({ value: bar.open }))
}

const pane = ($: Engine) => $.ui.mount({ plugin: 'disk-janitor', surface: 'terminal', component: 'Pane', requestId: 'disk-janitor', props: PANE })

describe('disk-janitor', () => {
  test('lists the artifacts with their sizes, never a data directory, and shows the total over 5 GB', async ($, on) => {
    const w = world(on)
    await started($, w)
    expect(w.statuses.at(-1)).toBe('artifacts 6.5 GB · /disk-janitor')
    expect((await $.command.run(run('list'))).text).toBe([
      `${ROOT} · 4 artifact dir(s) · 6.5 GB`,
      'node_modules  2.0 GB',
      'target  4.0 GB',
      'dist  1 MB  (unsure)',
      'data/venv  512 MB',
      'kept, data: data',
    ].join('\n'))
  })

  withSidebar('an open sidebar takes the total, its size in yellow, and the deletion goes under it', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($, w)
    expect(bar.sections.at(-1)).toEqual({
      key: 'artifacts',
      lines: [{ text: 'artifacts 6.5 GB · /disk-janitor', parts: [{ text: 'artifacts ' }, { text: '6.5 GB', kind: 'warn' }, { text: ' · /disk-janitor', kind: 'dim' }] }],
      buttons: [{ label: 'clean up', command: 'disk-janitor' }],
    })
    expect(w.statuses.at(-1)).toBe(undefined)
    // The button runs the command as a plugin: it opens the pane, and deletes nothing by itself.
    expect((await $.command.run(run('', { kind: 'plugin' } as PromptOrigin))).text).toBe('pane open: Enter picks a row, the delete button asks twice, Esc closes')
    expect(w.panes.map(p => p.id)).toEqual(['disk-janitor'])
    expect(w.removed).toEqual([])
    const ui = await pane($)
    await ui.press({ key: 'row:target' })
    await ui.press({ key: 'delete' })
    await ui.press({ key: 'delete' })
    await w.clock.settle()
    // Under 5 GB the section goes down, so the last write is the clear.
    expect(bar.cleared).toEqual(['artifacts'])
  })

  withSidebar('over 20 GB the total is red, and the deletion stands under it', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.sizes.set(`${ROOT}/target`, 30 * GB)
    await started($, w)
    expect(bar.sections.at(-1)?.lines[0]).toEqual({
      text: 'over 20 GB: artifacts 32.5 GB · /disk-janitor',
      parts: [{ text: 'over 20 GB: artifacts ' }, { text: '32.5 GB', kind: 'error' }, { text: ' · /disk-janitor', kind: 'dim' }],
    })
    expect((await $.command.run(run('delete dist'))).text).toContain('deleted 1 dir(s)')
    await w.clock.settle()
    expect(bar.sections.at(-1)?.lines[1]).toEqual({ text: 'deleted 1 dir(s), 1 MB', parts: [{ text: 'deleted 1 dir(s), 1 MB', kind: 'ok' }] })
  })

  test('the pane deletes the picked directories on the second press, and logs what went and what stayed', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await pane($)
    expect((await ui.find({ type: 'Button', key: 'row:dist' }))?.props.label).toBe('[ ] dist  1 MB  (unsure)')
    expect((await ui.find({ type: 'Button', key: 'row:target' }))?.props.label).toBe('[x] target  4.0 GB')
    await ui.press({ key: 'row:target' })
    await ui.press({ key: 'delete' })
    expect(w.removed).toEqual([])
    expect((await ui.find({ type: 'Button', key: 'delete' }))?.props.label).toBe('Press again to delete 2 dir(s), 2.5 GB')
    await ui.press({ key: 'delete' })
    await w.clock.settle()
    expect(w.removed).toEqual([`${ROOT}/node_modules`, `${ROOT}/data/venv`])
    expect(w.logs).toEqual(['deleted 2 dir(s), 2.5 GB: node_modules (2.0 GB), data/venv (512 MB) · kept, data: data'])
    expect(w.statuses.at(-1)).toBe(undefined)
    // The rescan keeps target unpicked, as the person left it.
    expect((await ui.find({ type: 'Button', key: 'row:target' }))?.props.label).toBe('[ ] target  4.0 GB')
  })

  test('skips a picked directory that is no longer ignored or became a link', async ($, on) => {
    const w = world(on)
    await started($, w)
    w.notIgnored.add('node_modules')
    w.links.add(`${ROOT}/data/venv`)
    const ui = await pane($)
    await ui.press({ key: 'delete' })
    await ui.press({ key: 'delete' })
    await w.clock.settle()
    expect(w.removed).toEqual([`${ROOT}/target`])
    expect(w.logs[0]).toBe('deleted 1 dir(s), 4.0 GB: target (4.0 GB) · skipped: node_modules (no longer git-ignored), data/venv (no longer a directory) · kept, data: data')
  })

  test('/disk-janitor delete works for a person only, and only on a listed path', async ($, on) => {
    const w = world(on)
    await started($, w)
    expect((await $.command.run(run('delete dist', { kind: 'plugin', name: 'x' } as unknown as PromptOrigin))).text).toBe('refused: only you can delete, from the prompt or the pane')
    expect((await $.command.run(run('delete data'))).text).toBe('not listed: data; /disk-janitor list shows what can be deleted')
    expect(w.removed).toEqual([])
    expect((await $.command.run(run('delete dist/'))).text).toBe('deleted 1 dir(s), 1 MB: dist (1 MB) · kept, data: data')
    expect(w.removed).toEqual([`${ROOT}/dist`])
    expect((await $.command.run(run('wipe'))).text).toBe('expects nothing (the pane), list, rescan, or delete <path>')
  })

  test('opens and closes the pane, measures again at most every 10 minutes, and does nothing outside git', async ($, on) => {
    const w = world(on)
    await started($, w)
    expect((await $.command.run(run(''))).text).toBe('pane open: Enter picks a row, the delete button asks twice, Esc closes')
    expect((await $.command.run(run(''))).text).toBe('pane closed')
    await w.clock.settle()
    const measured = w.statuses.length
    await $.turn.complete(turn)
    await w.clock.settle()
    expect(w.statuses.length).toBe(measured)
    w.inGit = false
    await w.clock.advance(10 * 60 * 1000)
    await $.turn.complete(turn)
    await w.clock.settle()
    expect(w.statuses.length).toBe(measured + 1)
    expect(w.statuses.at(-1)).toBe(undefined)
    expect((await $.command.run(run('list'))).text).toBe('not measured yet, or not in a git repository')
  })
})
