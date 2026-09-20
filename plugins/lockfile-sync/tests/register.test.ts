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

type Bar = { open: boolean; sections: { key: string; title: string; lines: string[] }[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    const c = e as unknown as { key: string }
    bar.cleared.push(c.key)
    bar.sections = bar.sections.filter(s => s.key !== c.key)
    return { value: undefined }
  })
}

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'lockfile-sync', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const DEP_DIFF = '@@ -1,5 +1,5 @@\n {\n   "dependencies": {\n-    "left-pad": "^1.0.0"\n+    "left-pad": "^1.3.0"\n   }\n }\n'

/**
 * `head` moves to `next` when a commit runs; `names` is the commit's name-status; `files` are the paths on disk;
 * `showFails` makes git show fail; `notRepo` makes the directory no repository.
 */
type World = { head: string; next: string; names: string; files: Set<string>; argv: string[]; logs: string[]; commitFails: boolean; showFails: boolean; notRepo: boolean; lockDirty: boolean }

function world(on: On): World {
  const w: World = {
    head: 'aaa', next: 'bbb', names: 'M\tpackage.json\n', files: new Set([`${ROOT}/package-lock.json`]),
    argv: [], logs: [], commitFails: false, showFails: false, notRepo: false, lockDirty: false,
  }
  mock.store(on, {})
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    w.argv.push(cmd)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    if (cmd === 'git rev-parse --show-toplevel') return w.notRepo ? { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } : ok(`${ROOT}\n`)
    if (cmd === 'git rev-parse HEAD') return ok(`${w.head}\n`)
    if (cmd.startsWith('git status')) return ok(w.lockDirty ? ' M package-lock.json\n' : '')
    if (w.showFails) return { value: { exitCode: 128, stdout: '', stderr: 'bad' } }
    return ok(cmd.includes('--name-status') ? w.names : DEP_DIFF)
  })
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    if (w.commitFails) return { result: 'Error: Exit code 1', text: 'Exit code 1', isError: true } as never
    if (e.command.includes('commit')) w.head = w.next
    return { result: 'ok' } as never
  })
  return w
}

const NOTE = "lockfile-sync: this commit changes package.json but not package-lock.json. Run the package manager's install so the lockfile matches, and commit it."

describe('lockfile-sync', () => {
  test('a commit that changes a dependency without the lockfile gets the note', async ($, on) => {
    const w = world(on)
    expect((await $.tool.call({ tool: 'Bash', command: 'git add package.json && git commit -m bump' })).context).toEqual([NOTE])
    expect(w.argv).toEqual([
      'git rev-parse --show-toplevel',
      'git rev-parse HEAD',
      'git rev-parse HEAD',
      'git show --format= --name-status --no-renames HEAD',
      'git show --format= --unified=20 --no-color --no-ext-diff HEAD -- package.json',
    ])
    expect(w.logs).toEqual(['this commit changes package.json but not package-lock.json'])
  })

  withSidebar('an open sidebar takes the pairs and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    expect(bar.sections).toEqual([{ key: 'package.json', title: 'lockfiles the commit left out', lines: ['package.json but not package-lock.json'] }])
    expect(w.logs).toEqual([])
  })

  withSidebar('a later commit that brings the lockfile clears the entry and writes a new one', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    w.names = 'M\tpackage-lock.json\n'
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m lock' })).context).toBe(undefined)
    expect(bar.cleared).toEqual(['package.json'])
    expect(bar.sections).toEqual([{ key: 'package.json', title: 'lockfiles updated', lines: ['package-lock.json now matches package.json'] }])
  })

  test('the transcript reads the closed finding when the sidebar is not there', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    w.names = 'M\tpackage-lock.json\n'
    w.next = 'ccc'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m lock' })
    expect(w.logs[1]).toBe('a later commit brought the lockfiles along: package-lock.json')
  })

  test('a workspace manifest pairs with the root lockfile', async ($, on) => {
    const w = world(on)
    w.names = 'M\tpackages/web/package.json\n'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context?.[0]).toContain('changes packages/web/package.json but not package-lock.json.')
  })

  test('no note with the lockfile in the commit, without a lockfile, for another command, a failed or empty commit, outside a repository, or when off', async ($, on) => {
    const w = world(on)
    w.names = 'M\tpackage.json\nM\tpackage-lock.json\n'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.names = 'M\tpackage.json\n'
    w.files = new Set()
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.files = new Set([`${ROOT}/package-lock.json`])
    w.next = 'ddd'
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).context).toBe(undefined)
    w.commitFails = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.commitFails = false
    w.next = w.head
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    w.notRepo = true
    w.next = 'eee'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).context).toBe(undefined)
    expect((await $.command.run(run('off'))).text).toBe('off: commits are not checked')
    const before = w.argv.length
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.argv.length).toBe(before)
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no lockfile is open')
    expect(w.logs).toEqual([])
  })

  test('in deny mode a push stops while the lockfile is behind, and runs once the working tree has it', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a lockfile is behind its manifest')
    const denied = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(denied.deny).toContain('stopped: 1 lockfile(s) are behind their manifest: package-lock.json behind package.json')
    expect(denied.result).toBe(undefined)
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).result).toBe('ok')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · package-lock.json still behind')
    // The package manager wrote the lockfile: the gate reads the working tree and opens.
    w.lockDirty = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git merge main' })).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('a later commit brought the lockfiles along: package-lock.json')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('a git error is logged once and the commit result stays', async ($, on) => {
    const w = world(on)
    w.showFails = true
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).toEqual({ result: 'ok' })
    w.next = 'fff'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })
    expect(w.logs).toEqual(["the commit's lockfiles were not checked: git show --name-status HEAD failed"])
  })
})
