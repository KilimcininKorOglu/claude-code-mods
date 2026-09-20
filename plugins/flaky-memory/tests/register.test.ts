import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { WINDOW_MS } from '../hooks/history.ts'

tier('user')

const FAIL = '=== RUN   TestX\n--- FAIL: TestX (0.00s)\nFAIL\nFAIL\texample.com/x\t0.1s'
const PASS = '=== RUN   TestX\n--- PASS: TestX (0.00s)\nPASS\nok  \texample.com/x\t0.1s'

const run = (args: string): CommandRunInput => ({
  command: 'flaky', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** What Bash prints next: its text, and whether it exits non-zero. */
type Output = { text: string; failed?: boolean; interrupted?: boolean }

type World = {
  clock: MockClock
  store: Map<string, unknown>
  outputs: Output[]
  commands: string[]
  git: string[]
  logs: string[]
  /** The working tree's diff; changing it changes the fingerprint. */
  diff: string
  inGit: boolean
}

function gitAnswer(w: World, argv: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  if (!w.inGit) return { exitCode: 128, stdout: '', stderr: 'not a git repository' }
  if (argv.includes('--git-common-dir')) return { exitCode: 0, stdout: '/src/app/.git\n', stderr: '' }
  if (argv.includes('HEAD') && argv[1] === 'rev-parse') return { exitCode: 0, stdout: 'abc123\n', stderr: '' }
  if (argv[1] === 'diff') return { exitCode: 0, stdout: w.diff, stderr: '' }
  return { exitCode: 0, stdout: '', stderr: '' }
}

/** Bash's result as the engine hands it back: a failure as error text, a success as the run's fields. */
function bashResult(o: Output): unknown {
  if (o.failed === true) return { result: `Error: Exit code 1\n${o.text}`, text: `Exit code 1\n${o.text}`, isError: true }
  return { result: { stdout: o.text, stderr: '', interrupted: o.interrupted === true }, text: o.text }
}

function world(on: On, store: [string, unknown][] = []): World {
  const clock = mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') })
  const w: World = { clock, store: new Map(store), outputs: [], commands: [], git: [], logs: [], diff: '+a', inGit: true }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('session.cwd', () => ({ value: '/src/app' }))
  on('process.run', (_, e) => {
    w.git.push(e.argv.join(' '))
    return { value: gitAnswer(w, e.argv) }
  })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    w.commands.push(e.command)
    return bashResult(w.outputs.shift() ?? { text: '' }) as never
  })
  return w
}

const NOTE = 'flaky-memory: go:TestX failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once.'
const LINE = 'go:TestX failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once'

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Bar = { open: boolean; sections: { key: string; title: string; lines: { text: string; kind?: string }[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => ({ text: l.text, kind: l.kind })) })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    bar.cleared.push((e as unknown as { key: string }).key)
    return { value: undefined }
  })
  on('sidebar.isOpen', () => ({ value: bar.open }))
}

describe('flaky-memory', () => {
  test('a test that passed and failed on the same tree gets a note on its next failure', async ($, on) => {
    const w = world(on)
    w.outputs.push({ text: FAIL, failed: true }, { text: PASS }, { text: FAIL, failed: true })
    const first = await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(first.context).toBe(undefined)
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    const third = await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(third.context).toEqual([expect.stringContaining(NOTE)])
    expect(third.isError).toBe(true)
    expect(w.git).toContain('git rev-parse --path-format=absolute --git-common-dir')
    expect(w.store.has('runs:/src/app/.git')).toBe(true)
    // The person reads the finding alone, without the instruction the model reads.
    expect(w.logs).toEqual([LINE])
  })

  withSidebar('an open sidebar takes the finding in red, and the closing in green', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.outputs.push({ text: FAIL, failed: true }, { text: PASS }, { text: FAIL, failed: true })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(bar.sections).toEqual([{ key: 'go:TestX', title: 'flaky test', lines: [{ text: LINE, kind: 'error' }] }])
    expect(w.logs).toEqual([])
    // A week later the contradicting runs are outside the window, and the next run closes the finding.
    await w.clock.advance(WINDOW_MS + 1000)
    w.outputs.push({ text: FAIL, failed: true })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(bar.cleared).toEqual(['go:TestX'])
    expect(bar.sections.at(-1)).toEqual({ key: 'go:TestX', title: 'no longer flaky', lines: [{ text: expect.stringContaining('no longer flaky'), kind: 'ok' }] })
  })

  test('a failure after a code change is not called flaky', async ($, on) => {
    const w = world(on)
    w.outputs.push({ text: FAIL, failed: true }, { text: PASS }, { text: FAIL, failed: true })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    w.diff = '+b'
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    w.diff = '+c'
    const r = await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(r.context).toBe(undefined)
  })

  test('leaves other commands, interrupted runs, runs outside git and runs while off alone', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'go build ./...' })
    expect(w.git).toEqual([])
    w.outputs.push({ text: FAIL, interrupted: true })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(w.store.size).toBe(0)
    w.inGit = false
    w.outputs.push({ text: FAIL, failed: true })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(w.store.size).toBe(0)
    expect(await $.command.run(run('off'))).toEqual({ text: 'off: test runs are not recorded; the stored runs stay' })
    w.inGit = true
    w.git = []
    w.outputs.push({ text: FAIL, failed: true })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(w.git).toEqual([])
    expect(w.commands).toHaveLength(4)
  })

  test('/flaky lists, forgets one test or all, and refuses other words', async ($, on) => {
    const w = world(on)
    w.outputs.push({ text: FAIL, failed: true }, { text: PASS })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(await $.command.run(run(''))).toEqual({ text: 'on · go:TestX · failed 1/2 · same code once' })
    expect(await $.command.run(run('reset go:TestY'))).toEqual({ text: 'no runs of go:TestY' })
    expect(await $.command.run(run('reset go:TestX'))).toEqual({ text: 'the runs of go:TestX are forgotten' })
    expect(await $.command.run(run(''))).toEqual({ text: 'on · no flaky test in the last 7 days (0 tests seen)' })
    expect(await $.command.run(run('reset'))).toEqual({ text: 'the runs of this repository are forgotten' })
    expect(w.store.has('runs:/src/app/.git')).toBe(false)
    expect(await $.command.run(run('list'))).toEqual({ text: 'expects nothing (the flaky tests), reset, reset <test id>, on or off' })
  })

  test('a stored value of another shape is reported and started over', async ($, on) => {
    const w = world(on, [['runs:/src/app/.git', { tests: 1 }]])
    w.outputs.push({ text: FAIL, failed: true })
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(w.logs).toEqual(['the stored runs of /src/app/.git have an unknown shape; starting over'])
    expect(Object.keys((w.store.get('runs:/src/app/.git') as { tests: object }).tests)).toEqual(['go:TestX'])
  })
})
