import { describe, expect, mock, test, tier, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { adviceFor, fmtKb, limitOf, sizeOf, statusText } from '../hooks/flood.ts'

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

type Bar = { open: boolean; sections: { key: string; lines: string[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
}

const run = (args: string): CommandRunInput => ({
  command: 'output-flood', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** The logged lines, and the Bash result the world answers with. */
type World = { logs: string[]; result: { stdout: string; stderr: string; backgroundTaskId?: string }; isError?: true }

function world(on: On): World {
  const w: World = { logs: [], result: { stdout: '', stderr: '' } }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  // A non-zero exit is an error result: `result` holds the error text, never the tool's record, and
  // `text` is what the model reads, `Exit code N` and the output.
  on('tool.call', { tool: 'Bash' }, () => {
    if (w.isError !== true) return { result: w.result } as never
    const text = `Exit code 1\n${w.result.stdout}\n${w.result.stderr}`
    return { result: text, text, isError: true } as never
  })
  return w
}

const bash = (command: string) => ({ tool: 'Bash' as const, command })

describe('output-flood', () => {
  test('reads a size, a limit and the advice per kind of command', () => {
    expect(sizeOf('abc', 'de')).toBe(5)
    expect(fmtKb(1024)).toBe('1.0 KB')
    expect(fmtKb(30 * 1024)).toBe('30 KB')
    for (const bad of ['0', '1001', 'big', '']) expect(limitOf(bad), bad).toBe(undefined)
    expect(limitOf('20')).toBe(20)
    expect(adviceFor('pytest tests/')).toContain('run the one test')
    expect(adviceFor('git log --oneline')).toContain('bound it')
    expect(adviceFor('./weird-tool')).toContain('> /tmp/run.log')
    expect(statusText(true, 20, 0, 0)).toBe('on · limit 20 KB · no result over it yet')
  })

  test('a result over the limit gets a note, and a smaller one none', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
    w.result = { stdout: 'x'.repeat(10_000), stderr: '' }
    expect((await $.tool.call(bash('pytest tests/'))).context).toBe(undefined)
    w.result = { stdout: 'x'.repeat(30 * 1024), stderr: 'y'.repeat(100) }
    const r = await $.tool.call(bash('pytest tests/ -v'))
    expect(r.context?.[0]).toContain('"pytest tests/ -v" returned 30 KB of output, over the 20 KB limit')
    expect(r.context?.[0]).toContain('Next time run the one test')
    expect(w.logs).toEqual(['30 KB of output from "pytest tests/ -v", over 20 KB'])
    expect((await $.command.run(run(''))).text).toBe('on · limit 20 KB · 1 result(s) over it, 30 KB in all')
  })

  test('a failed run over the limit is measured from its error text, which stays as it is', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
    w.isError = true
    w.result = { stdout: 'F'.repeat(30 * 1024), stderr: '' }
    const r = await $.tool.call(bash('npm test'))
    expect(r.isError).toBe(true)
    expect(r.text).toBe(`Exit code 1\n${'F'.repeat(30 * 1024)}\n`)
    expect(r.context?.[0]).toContain('"npm test" returned 30 KB of output, over the 20 KB limit')
    expect(w.logs).toEqual(['30 KB of output from "npm test", over 20 KB'])
  })

  test('the same command is reported once, and a backgrounded command is not measured', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
    w.result = { stdout: 'x'.repeat(30 * 1024), stderr: '' }
    await $.tool.call(bash('make build'))
    expect((await $.tool.call(bash('make build'))).context).toBe(undefined)
    expect(w.logs).toHaveLength(1)
    w.result = { stdout: 'x'.repeat(30 * 1024), stderr: '', backgroundTaskId: 'b1' }
    expect((await $.tool.call(bash('make watch'))).context).toBe(undefined)
  })

  test('the limit the person sets holds, and off measures nothing', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number of KB from 1 to 1000')
    expect((await $.command.run(run('limit 1'))).text).toBe('limit 1 KB: a result over 1 KB is reported')
    w.result = { stdout: 'x'.repeat(2 * 1024), stderr: '' }
    expect((await $.tool.call(bash('ls -R /'))).context?.[0]).toContain('over the 1 KB limit')
    expect((await $.command.run(run('off'))).text).toBe('off: results are not measured')
    expect((await $.tool.call(bash('du -a /'))).context).toBe(undefined)
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on, off or limit <kb>')
  })

  withSidebar('an open sidebar takes the finding and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
    w.result = { stdout: 'x'.repeat(30 * 1024), stderr: '' }
    await $.tool.call(bash('git log'))
    expect(bar.sections).toHaveLength(1)
    expect(bar.sections[0]?.lines[0]).toBe('30 KB of output from "git log", over 20 KB')
    expect(bar.sections[0]?.lines[1]).toContain('bound it')
    expect(w.logs).toEqual([])
  })
})
