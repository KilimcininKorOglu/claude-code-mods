import { describe, expect, test, tier } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'doc-drift-watch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const OLD = '<doc p="README.md"><a k="file-line" l="20" why="missing-file" ref="sub/pay.ts:1"/></doc>'
const NEW = '<doc p="README.md"><a k="file-line" l="20" why="missing-file" ref="sub/pay.ts:1"/><a k="file-line" l="3" why="past-eof" ref="main.go:90"/></doc>'

type World = { outputs: string[]; argv: string[]; logs: string[]; store: Map<string, unknown>; commitFails: boolean; ripwireFails: boolean }

function world(on: On): World {
  const w: World = { outputs: [OLD, NEW], argv: [], logs: [], store: new Map(), commitFails: false, ripwireFails: false }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.cwd', () => ({ value: '/src/app/sub' }))
  on('process.run', (_, e) => {
    w.argv.push(e.argv.join(' '))
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: '/src/app\n', stderr: '' } }
    if (w.ripwireFails) return { value: { exitCode: 127, stdout: '', stderr: 'ripwire: command not found' } }
    return { value: { exitCode: 0, stdout: w.outputs.shift() ?? '', stderr: '' } }
  })
  on('tool.call', { tool: 'Bash' }, () => (w.commitFails ? { result: 'Error: Exit code 1', text: 'Exit code 1', isError: true } : { result: 'ok' }) as never)
  return w
}

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
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })

  test('a ripwire failure lets the commit run and is logged once', async ($, on) => {
    const w = world(on)
    w.ripwireFails = true
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).toEqual({ result: 'ok' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })
    expect(w.logs).toEqual(['the docs were not checked: ripwire --doc-drift failed: ripwire: command not found'])
  })
})
