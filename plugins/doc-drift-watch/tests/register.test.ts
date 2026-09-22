import { describe, expect, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

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

type Bar = { open: boolean; sections: { key: string; lines: string[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => { bar.cleared.push((e as unknown as { key: string }).key); return { value: undefined } })
}

const run = (args: string): CommandRunInput => ({
  command: 'doc-drift-watch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const OLD = '<doc p="README.md"><a k="file-line" l="20" why="missing-file" ref="sub/pay.ts:1"/></doc>'
const NEW = '<doc p="README.md"><a k="file-line" l="20" why="missing-file" ref="sub/pay.ts:1"/><a k="file-line" l="3" why="past-eof" ref="main.go:90"/></doc>'

/** The one anchor the commit added, as a narrowed re-measure of README.md answers it while it stands. */
const STILL = '<doc p="README.md"><a k="file-line" l="4" why="past-eof" ref="main.go:90"/></doc>'

type World = {
  outputs: string[]
  rechecks: string[]
  argv: string[]
  logs: string[]
  notes: string[]
  store: Map<string, unknown>
  staged: string[]
  docGone: boolean
  commitFails: boolean
  ripwireFails: boolean
}

/** git answers the repository root, and the index its own staged paths, NUL separated as the mod reads them. */
function gitAnswer(w: World, argv: readonly string[]): { value: { exitCode: number; stdout: string; stderr: string } } {
  if (argv.includes('diff')) return { value: { exitCode: 0, stdout: w.staged.join('\0'), stderr: '' } }
  return { value: { exitCode: 0, stdout: '/src/app\n', stderr: '' } }
}

/** A narrowed run (`--doc-drift=<doc>`) is a re-measure; a whole-repository run is a commit's own check. */
function ripwireAnswer(w: World, argv: readonly string[]): { value: { exitCode: number; stdout: string; stderr: string } } {
  if (w.ripwireFails) return { value: { exitCode: 127, stdout: '', stderr: 'ripwire: command not found' } }
  const narrowed = argv.some(a => a.startsWith('--doc-drift='))
  return { value: { exitCode: 0, stdout: (narrowed ? w.rechecks.shift() : w.outputs.shift()) ?? '', stderr: '' } }
}

function world(on: On): World {
  const w: World = { outputs: [OLD, NEW], rechecks: [], argv: [], logs: [], notes: [], store: new Map(), staged: [], docGone: false, commitFails: false, ripwireFails: false }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.cwd', () => ({ value: '/src/app/sub' }))
  on('fs.read', () => {
    if (w.docGone) throw new Error('ENOENT')
    return { value: '# doc' }
  })
  on('process.run', (_, e) => {
    w.argv.push(e.argv.join(' '))
    return e.argv[0] === 'git' ? gitAnswer(w, e.argv) : ripwireAnswer(w, e.argv)
  })
  on('tool.call', { tool: 'Bash' }, () => (w.commitFails ? { result: 'Error: Exit code 1', text: 'Exit code 1', isError: true } : { result: 'ok' }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('prompt.submit', (_, e) => { w.notes.push(...(e.context ?? [])); return { text: e.text } })
  return w
}

/** One main-loop turn's end, which measures every open finding again. */
const endTurn = ($: Engine) => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

describe('doc-drift-watch', () => {
  test('a commit that makes a doc line stale adds a note; an old stale line is not repeated', async ($, on) => {
    const w = world(on)
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(r.context).toEqual(['doc-drift-watch: this commit made 1 doc line(s) stale: README.md:3 points at main.go:90, past the end of that file. Update them in a follow-up commit, or tell the user why a line stays.'])
    expect(w.argv).toEqual([
      'git rev-parse --show-toplevel',
      'ripwire /src/app --doc-drift --with-history',
      'ripwire /src/app --doc-drift --with-history',
    ])
    expect(w.logs).toEqual(['1 doc line(s) stale: README.md:3 points at main.go:90, past the end of that file'])
    expect((await $.command.run(run(''))).text).toBe('on · mode note · README.md (1) still stale; it needs ripwire on PATH')
  })

  withSidebar('an open sidebar takes the stale lines and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(bar.sections).toEqual([{ key: 'README.md', lines: ['README.md:3 points at main.go:90, past the end of that file'] }])
    expect(w.logs).toEqual([])
  })

  test('another command, a failed commit and off add nothing', async ($, on) => {
    const w = world(on)
    expect(await $.tool.call({ tool: 'Bash', command: 'git status' })).toEqual({ result: 'ok' })
    expect(w.argv).toEqual([])
    w.commitFails = true
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.argv).toHaveLength(2)
    expect((await $.command.run(run('off'))).text).toBe('off: commits are not checked')
    w.commitFails = false
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).toEqual({ result: 'ok' })
    expect(w.argv).toHaveLength(2)
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
  })

  test('a ripwire failure lets the commit run and is logged once', async ($, on) => {
    const w = world(on)
    w.ripwireFails = true
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).toEqual({ result: 'ok' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })
    expect(w.logs).toEqual(['the docs were not checked: ripwire --doc-drift failed: ripwire: command not found'])
  })

  withSidebar('the turn measures the open doc again and closes the finding it no longer holds', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    w.rechecks = ['<doc-drift docs="1" drift="0"></doc-drift>']
    await endTurn($)
    expect(w.argv.at(-1)).toBe('ripwire /src/app --doc-drift=README.md --with-history')
    expect(bar.cleared).toEqual(['README.md'])
    expect(bar.sections.at(-1)).toEqual({ key: 'README.md', lines: ['README.md: 1 doc line(s) hold again'] })
    expect((await $.command.run(run(''))).text).toBe('on · mode note · no doc is open; it needs ripwire on PATH')
  })

  test('a doc that is gone closes the finding from the other side', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    w.rechecks = ['']
    w.docGone = true
    await endTurn($)
    expect(w.logs.at(-1)).toBe('README.md is gone, and its 1 stale line(s) with it')
  })

  test('a finding that still stands reaches the model once at the next prompt', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    w.rechecks = [STILL]
    await endTurn($)
    await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' }, wait: false })
    await $.prompt.submit({ text: 'and on', origin: { kind: 'composer' }, wait: false })
    expect(w.notes).toEqual(['doc-drift-watch: 1 doc(s) still hold stale lines: README.md (1). Update them.'])
  })

  test('deny mode stops a push while the doc is stale and lets it run once the doc holds again', async ($, on) => {
    const w = world(on)
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a doc line stays stale')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    w.rechecks = [STILL]
    const stopped = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(stopped.deny).toBe('stopped: 1 doc(s) still hold stale lines: README.md (1). Update them and run the command again; there is no way around this gate.')
    w.rechecks = ['']
    expect(await $.tool.call({ tool: 'Bash', command: 'git push' })).toEqual({ result: 'ok' })
  })

  test('a commit that holds none of the open docs runs in deny mode', async ($, on) => {
    const w = world(on)
    await $.command.run(run('mode deny'))
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    w.rechecks = [STILL]
    w.staged = ['src/other.ts']
    w.outputs = [OLD, OLD]
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })).toEqual({ result: 'ok' })
    expect(w.logs.at(-1)).toBe('1 doc(s) still hold stale lines, and this command holds none of them')
  })
})
