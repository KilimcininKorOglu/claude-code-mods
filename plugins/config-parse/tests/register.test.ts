import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
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

type Bar = { open: boolean; sections: { key: string; title: string; lines: string[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    bar.cleared.push((e as unknown as { key: string }).key)
    return { value: undefined }
  })
}

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'config-parse', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** The text every read answers with, what python answers, and the lines logged. */
type World = { file: string; python: { exitCode: number; stderr: string }; argv: (readonly string[])[]; logs: string[] }

function world(on: On): World {
  const w: World = { file: '', python: { exitCode: 0, stderr: '' }, argv: [], logs: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('fs.read', () => ({ value: w.file }) as never)
  on('process.run', (_, e) => {
    w.argv.push(e.argv)
    return { value: { exitCode: w.python.exitCode, stdout: '', stderr: w.python.stderr } }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }) as never)
  return w
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const edit = ($: Engine, file: string) =>
  $.tool.call({ tool: 'Edit', file_path: `${ROOT}/${file}`, old_string: 'a', new_string: 'b' } as never)

describe('config-parse', () => {
  test('a broken JSON file gets the note and the transcript line, and a good one gets neither', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = '{"a": 1,}'
    const r = await edit($, 'package.json')
    expect(r.context?.[0]).toMatch(/^config-parse: package\.json does not parse as JSON after this edit: /)
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]).toMatch(/^package\.json does not parse as JSON: /)
    w.file = '{"a": 1}'
    expect((await edit($, 'other.json')).context).toBe(undefined)
  })

  test('a YAML file is parsed by python, and its error reaches both channels', async ($, on) => {
    const w = world(on)
    await started($)
    w.python = { exitCode: 1, stderr: 'Traceback\nyaml.scanner.ScannerError: mapping values are not allowed here' }
    const r = await edit($, '.github/workflows/ci.yml')
    expect(w.argv[0]?.[0]).toBe('python3')
    expect(w.argv[0]?.at(-1)).toBe(`${ROOT}/.github/workflows/ci.yml`)
    expect(r.context?.[0]).toContain('does not parse as YAML after this edit: yaml.scanner.ScannerError: mapping values are not allowed here')
    expect(w.logs).toEqual(['.github/workflows/ci.yml does not parse as YAML: yaml.scanner.ScannerError: mapping values are not allowed here'])
  })

  test('a missing python module skips that kind, says so once, and sends no note', async ($, on) => {
    const w = world(on)
    await started($)
    w.python = { exitCode: 1, stderr: "ModuleNotFoundError: No module named 'yaml'" }
    expect((await edit($, 'a.yml')).context).toBe(undefined)
    expect((await edit($, 'b.yaml')).context).toBe(undefined)
    expect(w.logs).toEqual(["YAML files are not checked on this machine: No module named 'yaml'"])
    expect(w.argv).toHaveLength(1)
  })

  withSidebar('the sidebar takes the finding, and the fix clears it with a green line', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await started($)
    w.file = 'A=1\nthis is prose\n'
    await edit($, '.env')
    expect((await $.command.run(run(''))).text).toBe('on · mode note · .env does not parse')
    w.file = 'A=1\nB=2\n'
    await edit($, '.env')
    expect(bar.sections).toEqual([
      { key: '.env', title: 'config does not parse', lines: ['line 2 is not a setting: this is prose'] },
      { key: '.env', title: 'config parses again', lines: ['.env parses again'] },
    ])
    expect(bar.cleared).toEqual(['.env'])
    expect(w.logs).toEqual([])
    expect((await $.command.run(run(''))).text).toBe('on · mode note · no file is open')
  })

  test('a file that is not configuration, and off, are both left alone', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = '{"a": 1,}'
    expect((await edit($, 'src/main.ts')).context).toBe(undefined)
    expect((await $.command.run(run('off'))).text).toBe('off: edited files are not parsed')
    expect((await edit($, 'package.json')).context).toBe(undefined)
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
    expect(w.logs).toEqual([])
  })

  test('in deny mode a commit stops while a file does not parse, and runs once the edit fixes it', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = '{"a": 1,}'
    await edit($, 'package.json')
    expect((await bash($, 'git commit -m "wip"')).result).toBe('ran')
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a file does not parse')
    const denied = await bash($, 'git commit -m "wip"')
    expect(denied.deny).toContain('1 file(s) do not parse: package.json')
    expect(denied.result).toBe(undefined)
    // The gate leaves every other command alone.
    expect((await bash($, 'git status')).result).toBe('ran')
    // The file parses again: the gate rechecks it and lets the same command through.
    w.file = '{"a": 1}'
    const passed = await bash($, 'git push origin main')
    expect(passed.result).toBe('ran')
    expect(w.logs.at(-1)).toBe('package.json parses as JSON again')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · no file is open')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('the turn end measures the open file again and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    const notes: string[][] = []
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    on('prompt.submit', (_, e) => {
      notes.push([...(e.context ?? [])])
      return { text: e.text }
    })
    await started($)
    w.file = '{"a": 1,}'
    await edit($, 'package.json')
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe('config-parse: 1 file(s) still do not parse: package.json. Fix them.')
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    // The file parses again: the turn's end closes the finding and owes no note.
    w.file = '{"a": 1}'
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('package.json parses as JSON again')
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('a Write of a broken file is checked too', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = 'not = "toml'
    w.python = { exitCode: 1, stderr: 'TOMLDecodeError: Unterminated string (at line 1)' }
    const r = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/Cargo.toml`, content: 'not = "toml' } as never)
    expect(r.context?.[0]).toContain('Cargo.toml does not parse as TOML after this edit: Unterminated string (at line 1)')
  })
})
