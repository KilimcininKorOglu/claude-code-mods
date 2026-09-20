import { describe, expect, test, tier } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

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
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }) as never)
  return w
}

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

  test('a body edit runs nothing; off runs nothing', async ($, on) => {
    const w = world(on)
    expect(await $.tool.call(edit('return a', 'return a + 1'))).toEqual({ result: 'edited' })
    expect((await $.command.run(run('off'))).text).toBe('off: signatures are not checked')
    await $.tool.call(edit('func parse(a int) {', 'func parse(b int) {'))
    expect(w.argv).toEqual([])
    expect((await $.command.run(run(''))).text).toBe('off; it needs ripwire on PATH')
  })

  test('a ripwire failure is logged once and the edit result stays', async ($, on) => {
    const w = world(on)
    w.ripwire = { exitCode: 127, stdout: '', stderr: 'ripwire: command not found' }
    const r = await $.tool.call(edit('func parse(a int) {', 'func parse(b int) {'))
    await $.tool.call(edit('func parse(a int) {', 'func parse(b int) {'))
    expect(r).toEqual({ result: 'edited' })
    expect(w.logs).toEqual(['the callers were not checked: ripwire --edit-check failed: ripwire: command not found'])
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })
})
