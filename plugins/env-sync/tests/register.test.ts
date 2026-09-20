import { describe, expect, mock, test, tier, type Plugin, type TestBody } from 'claude-code/testing'
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

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'env-sync', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const DIFF = '+++ b/src/pay.ts\n@@ -0,0 +1,2 @@\n+const k = process.env.STRIPE_KEY\n+const d = process.env.DB_URL\n'

/**
 * `head` moves to `next` when the commit runs; `files` are the files on disk; `showFails` makes git show fail;
 * `notRepo` makes the directory no repository.
 */
type World = { head: string; next: string; files: Map<string, string>; argv: string[]; logs: string[]; commitFails: boolean; showFails: boolean; notRepo: boolean }

function world(on: On): World {
  const w: World = {
    head: 'aaa', next: 'bbb', files: new Map([[`${ROOT}/.env.example`, 'DB_URL=postgres://localhost/app\n']]),
    argv: [], logs: [], commitFails: false, showFails: false, notRepo: false,
  }
  mock.store(on, {})
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.cwd', () => ({ value: `${ROOT}/src` }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: w.files.get(e.path) ?? '' }) as never)
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    w.argv.push(cmd)
    if (cmd === 'git rev-parse --show-toplevel') return { value: w.notRepo ? { exitCode: 128, stdout: '', stderr: 'not a git repository' } : { exitCode: 0, stdout: `${ROOT}\n`, stderr: '' } }
    if (cmd === 'git rev-parse HEAD') return { value: w.head === '' ? { exitCode: 128, stdout: '', stderr: 'unknown revision' } : { exitCode: 0, stdout: `${w.head}\n`, stderr: '' } }
    return { value: w.showFails ? { exitCode: 128, stdout: '', stderr: 'bad' } : { exitCode: 0, stdout: DIFF, stderr: '' } }
  })
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    if (w.commitFails) return { result: 'Error: Exit code 1', text: 'Exit code 1', isError: true } as never
    if (e.command.includes('commit')) w.head = w.next
    return { result: 'ok' } as never
  })
  return w
}

const NOTE = 'env-sync: this commit reads env variables .env.example lacks: STRIPE_KEY (src/pay.ts:1). Add them to .env.example with a placeholder value, never a real secret.'

describe('env-sync', () => {
  test('a commit that reads a variable .env.example lacks gets the note', async ($, on) => {
    const w = world(on)
    const r = await $.tool.call({ tool: 'Bash', command: 'git add src/pay.ts && git commit -m pay' })
    expect(r.context).toEqual([NOTE])
    expect(w.argv).toEqual([
      'git rev-parse --show-toplevel',
      'git rev-parse HEAD',
      'git rev-parse HEAD',
      'git show --format= --unified=0 --no-color --no-ext-diff HEAD',
    ])
    expect(w.logs).toEqual(['env variables .env.example lacks: STRIPE_KEY (src/pay.ts:1)'])
  })

  withSidebar('an open sidebar takes the variables and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    expect(bar.sections).toEqual([{ key: '.env.example', lines: ['STRIPE_KEY (src/pay.ts:1)'] }])
    expect(w.logs).toEqual([])
  })

  test('the first commit of a repository is checked, and .env.sample is read when .env.example is missing', async ($, on) => {
    const w = world(on)
    w.head = ''
    w.files = new Map([[`${ROOT}/.env.sample`, 'export STRIPE_KEY=\n# DB_URL=\n']])
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m first' })).context).toBe(undefined)
    w.files = new Map([[`${ROOT}/.env.dist`, '']])
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m second' })).context?.[0]).toContain('reads env variables .env.dist lacks: STRIPE_KEY (src/pay.ts:1) · DB_URL (src/pay.ts:2)')
  })

  test('no note for another command, a failed or empty commit, no reference file, outside a repository, or when off', async ($, on) => {
    const w = world(on)
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).context).toBe(undefined)
    w.commitFails = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.commitFails = false
    w.next = 'aaa'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.next = 'ddd'
    w.files = new Map()
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.notRepo = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    expect(w.argv.filter(a => a.startsWith('git show'))).toEqual([])
    expect((await $.command.run(run('off'))).text).toBe('off: commits are not checked')
    const before = w.argv.length
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.argv.length).toBe(before)
    expect((await $.command.run(run(''))).text).toBe('off')
    expect(w.logs).toEqual([])
  })

  test('a git error is logged once and the commit result stays', async ($, on) => {
    const w = world(on)
    w.showFails = true
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).toEqual({ result: 'ok' })
    w.next = 'eee'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })
    expect(w.logs).toEqual(["the commit's env reads were not checked: git show HEAD failed"])
  })
})
