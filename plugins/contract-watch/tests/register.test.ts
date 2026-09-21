import { describe, expect, test, tier, type Plugin, type TestBody } from 'claude-code/testing'
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

type Bar = { open: boolean; sections: { key: string; lines: string[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
}

const run = (args: string): CommandRunInput => ({
  command: 'contract-watch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const CHECK = '<edit-check sym="parse" status="contract-change" params_was="1" params_now="2"><c n="main" p="cmd/main.go:5"/></edit-check>'

type World = { argv: string[][]; logs: string[]; store: Map<string, unknown>; ripwire: { exitCode: number; stdout: string; stderr: string } }

function world(on: On): World {
  const w: World = { argv: [], logs: [], store: new Map(), ripwire: { exitCode: 0, stdout: CHECK, stderr: '' } }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('process.run', (_, e) => {
    w.argv.push([...e.argv, `cwd=${e.init?.cwd}`])
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: '/src/app\ncmd/\n', stderr: '' } }
    return { value: w.ripwire }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }) as never)
  return w
}

/** The same check with callers ripwire calls incompatible, which is what the gate stops for. */
const BLOCKING = '<edit-check sym="parse" status="contract-change" params_was="1" params_now="2" incompatible="1"><c n="main" p="cmd/main.go:5"/></edit-check>'

/** The check of a symbol whose contract reads the same as the last commit again. */
const UNCHANGED = '<edit-check sym="parse" status="unchanged"><c n="main" p="cmd/main.go:5"/></edit-check>'

const edit = (before: string, after: string) => ({ tool: 'Edit' as const, file_path: '/src/app/cmd/parse.go', old_string: before, new_string: after, replace_all: false })

describe('contract-watch', () => {
  test('a changed signature asks ripwire, from the repository root, and adds the callers', async ($, on) => {
    const w = world(on)
    const r = await $.tool.call(edit('func parse(a int) int {', 'func parse(a int, b int) int {'))
    expect(r.context).toEqual(['contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (cmd/main.go:5).'])
    expect(w.argv).toEqual([
      ['git', 'rev-parse', '--show-toplevel', '--show-prefix', 'cwd=/src/app/cmd'],
      ['ripwire', '/src/app', '--edit-check=cmd/parse.go:parse', 'cwd=/src/app'],
    ])
    expect(w.logs).toEqual(['parse changed from 1 to 2 parameter(s); callers: main (cmd/main.go:5)'])
  })

  withSidebar('an open sidebar takes the callers and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await $.tool.call(edit('func parse(a int) int {', 'func parse(a int, b int) int {'))
    expect(bar.sections).toEqual([{ key: 'parse', lines: ['parse changed from 1 to 2 parameter(s)', 'main (cmd/main.go:5)'] }])
    expect(w.logs).toEqual([])
  })

  test('a body edit runs nothing; off runs nothing', async ($, on) => {
    const w = world(on)
    expect(await $.tool.call(edit('return a', 'return a + 1'))).toEqual({ result: 'edited' })
    expect((await $.command.run(run('off'))).text).toBe('off: signatures are not checked')
    await $.tool.call(edit('func parse(a int) {', 'func parse(b int) {'))
    expect(w.argv).toEqual([])
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no signature is open; it needs ripwire on PATH')
  })

  test('in deny mode a commit stops while a caller does not match, and runs once ripwire says it does', async ($, on) => {
    const w = world(on)
    w.ripwire = { exitCode: 0, stdout: BLOCKING, stderr: '' }
    await $.tool.call(edit('func parse(a int) int {', 'func parse(a int, b int) int {'))
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a caller does not match a changed signature')
    const denied = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    expect(denied.deny).toBe('stopped: 1 changed signature(s) leave a caller behind: parse changed from 1 to 2 parameter(s), 1 caller(s) do not match. Bring each caller to the new signature, then run the command again; there is no way around this gate.')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · 1 signature(s) have callers to check; it needs ripwire on PATH')
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' } as never)).result).toBe('ok')
    // The caller takes the new signature now: ripwire drops the mark and the gate opens.
    w.ripwire = { exitCode: 0, stdout: CHECK, stderr: '' }
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('no caller of parse carries the mismatch mark any more')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('in note mode a commit attempt closes a finding the model fixed, and stops nothing', async ($, on) => {
    const w = world(on)
    await $.tool.call(edit('func parse(a int) int {', 'func parse(a int, b int) int {'))
    expect((await $.command.run(run(''))).text).toBe('on · mode note · 1 signature(s) have callers to check; it needs ripwire on PATH')
    w.ripwire = { exitCode: 0, stdout: UNCHANGED, stderr: '' }
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('every caller matches parse again')
    expect((await $.command.run(run(''))).text).toBe('on · mode note · no signature is open; it needs ripwire on PATH')
  })

  test('a ripwire failure is logged once and the edit result stays', async ($, on) => {
    const w = world(on)
    w.ripwire = { exitCode: 127, stdout: '', stderr: 'ripwire: command not found' }
    const r = await $.tool.call(edit('func parse(a int) {', 'func parse(b int) {'))
    await $.tool.call(edit('func parse(a int) {', 'func parse(b int) {'))
    expect(r).toEqual({ result: 'edited' })
    expect(w.logs).toEqual(['the callers were not checked: ripwire --edit-check failed: ripwire: command not found'])
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
  })
})
