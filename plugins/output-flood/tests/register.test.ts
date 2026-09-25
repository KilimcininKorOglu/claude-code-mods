import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
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

/** The logged lines. */
type World = { logs: string[] }

function world(on: On): World {
  const w: World = { logs: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('classic.PostToolBatch', () => ({}))
  return w
}

type Call = { tool: string; command: string; response: unknown }

/**
 * A batch of calls as the engine hands it after they resolved: an untouched Bash result is the tool's
 * record, a rewritten or failed one the text the model reads.
 */
async function batch($: Engine, calls: Call[]): Promise<string[] | undefined> {
  const tool_calls = calls.map((c, i) => ({ tool_name: c.tool, tool_input: { command: c.command }, tool_use_id: `t${i}`, tool_response: c.response }))
  const r = await $.classic.PostToolBatch({ tool_calls } as never)
  return r.additionalContext
}

const bash = ($: Engine, command: string, response: unknown) => batch($, [{ tool: 'Bash', command, response }])

const record = (stdout: string, stderr = '') => ({ stdout, stderr, interrupted: false })

const started = ($: Engine) => $.session.start({ surface: null, isInteractive: true, cwd: '/work' })

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
    await started($)
    expect(await bash($, 'pytest tests/', record('x'.repeat(10_000)))).toBe(undefined)
    const notes = await bash($, 'pytest tests/ -v', record('x'.repeat(30 * 1024), 'y'.repeat(100)))
    expect(notes?.[0]).toContain('"pytest tests/ -v" returned 30 KB of output, over the 20 KB limit')
    expect(notes?.[0]).toContain('Next time run the one test')
    expect(w.logs).toEqual(['30 KB of output from "pytest tests/ -v", over 20 KB'])
    expect((await $.command.run(run(''))).text).toBe('on · limit 20 KB · 1 result(s) over it, 30 KB in all')
  })

  test('a result another mod shrank is measured as the model reads it, not as the command printed it', async ($, on) => {
    const w = world(on)
    await started($)
    expect(await bash($, 'yes | head -n 5000', 'y (×5000)')).toBe(undefined)
    expect(w.logs).toEqual([])
  })

  test('a failed run over the limit is measured from its error text', async ($, on) => {
    const w = world(on)
    await started($)
    const notes = await bash($, 'npm test', `<tool_use_error>Exit code 1\n${'F'.repeat(30 * 1024)}</tool_use_error>`)
    expect(notes?.[0]).toContain('"npm test" returned 30 KB of output, over the 20 KB limit')
    expect(w.logs).toEqual(['30 KB of output from "npm test", over 20 KB'])
  })

  test('each flooding call of a batch gets its note, and another tool\'s call is not measured', async ($, on) => {
    const w = world(on)
    await started($)
    const big = record('x'.repeat(30 * 1024))
    const notes = await batch($, [
      { tool: 'Bash', command: 'git log', response: big },
      { tool: 'Read', command: 'ignored', response: 'x'.repeat(30 * 1024) },
      { tool: 'Bash', command: 'find /', response: big },
    ])
    expect(notes).toHaveLength(2)
    expect(notes?.[1]).toContain('"find /" returned 30 KB')
    expect(w.logs).toHaveLength(2)
  })

  test('the same command is reported once, and a backgrounded command is not measured', async ($, on) => {
    const w = world(on)
    await started($)
    await bash($, 'make build', record('x'.repeat(30 * 1024)))
    expect(await bash($, 'make build', record('x'.repeat(30 * 1024)))).toBe(undefined)
    expect(w.logs).toHaveLength(1)
    // The repeat is quiet, and still counted: the status counts the results it sizes.
    expect((await $.command.run(run(''))).text).toBe('on · limit 20 KB · 2 result(s) over it, 60 KB in all')
    expect(await bash($, 'make watch', { ...record('x'.repeat(30 * 1024)), backgroundTaskId: 'b1' })).toBe(undefined)
  })

  test('the limit the person sets holds, and off measures nothing', async ($, on) => {
    world(on)
    await started($)
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number of KB from 1 to 1000')
    expect((await $.command.run(run('limit 1'))).text).toBe('limit 1 KB: a result over 1 KB is reported')
    expect((await bash($, 'ls -R /', record('x'.repeat(2 * 1024))))?.[0]).toContain('over the 1 KB limit')
    expect((await $.command.run(run('off'))).text).toBe('off: results are not measured')
    expect(await bash($, 'du -a /', record('x'.repeat(2 * 1024)))).toBe(undefined)
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on, off or limit <kb>')
  })

  withSidebar('an open sidebar takes the finding and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    await bash($, 'git log', record('x'.repeat(30 * 1024)))
    expect(bar.sections).toHaveLength(1)
    expect(bar.sections[0]?.lines[0]).toBe('30 KB of output from "git log", over 20 KB')
    expect(bar.sections[0]?.lines[1]).toContain('bound it')
    expect(w.logs).toEqual([])
  })
})
