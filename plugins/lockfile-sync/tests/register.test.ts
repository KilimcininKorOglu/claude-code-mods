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

/** The open flag, each section written, the keys cleared, and, when asked for, each line's colour. */
type Bar = { open: boolean; sections: { key: string; title: string; lines: string[] }[]; cleared: string[]; kinds?: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => l.text) })
    if (bar.open) bar.kinds?.push(...s.lines.map(l => l.kind ?? ''))
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

/** The manifest as it stands after that diff; the section of a changed line is read from it. */
const MANIFEST = '{\n  "dependencies": {\n    "left-pad": "^1.3.0"\n  }\n}\n'

/**
 * `head` moves to `next` when a commit runs; `names` is the commit's name-status; `files` are the paths on disk;
 * `showFails` makes git show fail; `notRepo` makes the directory no repository.
 */
type World = {
  head: string; next: string; names: string; files: Set<string>; argv: string[]; logs: string[]
  commitFails: boolean; showFails: boolean; notRepo: boolean; lockDirty: boolean; staged: string[]
  /** The commit that last wrote the lockfile, and the manifest's diff against it. */
  lockCommit: string; sinceLock: string
  /** What every package manager answers, or `throws` for one that cannot start; `treeMoved` puts the pair's files off HEAD. */
  tool: Ran | 'throws'; treeMoved: boolean
}

type Ran = { exitCode: number; stdout: string; stderr: string }

const ok = (stdout: string): Ran => ({ exitCode: 0, stdout, stderr: '' })
const failed = (stderr: string): Ran => ({ exitCode: 128, stdout: '', stderr })

const CARGO_DIFF = '@@ -1,3 +1,3 @@\n [dependencies]\n-serde = "1.0.100"\n+serde = "1.0.200"\n'

const CARGO = '[dependencies]\nserde = "1.0.200"\n'

/** What the world's git answers for one command; `git show` is the only one `showFails` breaks. */
function gitShow(w: World, cmd: string): Ran {
  if (w.showFails) return failed('bad')
  if (cmd.endsWith('Cargo.toml')) return ok(cmd.includes('HEAD:') ? CARGO : CARGO_DIFF)
  if (cmd.includes('HEAD:')) return ok(MANIFEST)
  return ok(cmd.includes('--name-status') ? w.names : DEP_DIFF)
}

/** The index, whether the pair's files are off HEAD, or the manifest's diff since the lockfile's commit. */
function gitDiff(w: World, cmd: string): Ran {
  if (cmd.startsWith('git diff --cached')) return ok(w.staged.join('\0'))
  if (cmd.startsWith('git diff --quiet')) return { exitCode: w.treeMoved ? 1 : 0, stdout: '', stderr: '' }
  return ok(w.sinceLock)
}

function gitAnswer(w: World, cmd: string): Ran {
  if (cmd === 'git rev-parse --show-toplevel') return w.notRepo ? failed('not a git repository') : ok(`${ROOT}\n`)
  if (cmd === 'git rev-parse HEAD') return ok(`${w.head}\n`)
  if (cmd.startsWith('git status')) return ok(w.lockDirty ? ' M package-lock.json\n' : '')
  if (cmd.startsWith('git log')) return ok(w.lockCommit === '' ? '' : `${w.lockCommit}\n`)
  if (cmd.startsWith('git diff')) return gitDiff(w, cmd)
  return gitShow(w, cmd)
}

function world(on: On): World {
  const w: World = {
    head: 'aaa', next: 'bbb', names: 'M\tpackage.json\n', files: new Set([`${ROOT}/package-lock.json`]),
    argv: [], logs: [], commitFails: false, showFails: false, notRepo: false, lockDirty: false, staged: ['package.json'],
    lockCommit: 'a1b2c3', sinceLock: DEP_DIFF,
    // A failure no check reads, so the manifest's diff decides unless a test says otherwise.
    tool: { exitCode: 2, stdout: '', stderr: 'unrelated' }, treeMoved: false,
  }
  mock.store(on, {})
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', () => ({ value: MANIFEST }))
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    w.argv.push(cmd)
    if (e.argv[0] === 'git') return { value: gitAnswer(w, cmd) }
    if (w.tool === 'throws') throw new Error(`${e.argv[0]}: command not found`)
    return { value: w.tool }
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
      'git diff --quiet HEAD -- package.json package-lock.json',
      'npm ci --dry-run --ignore-scripts',
      'git show --format= --unified=20 --no-color --no-ext-diff HEAD -- package.json',
      'git show HEAD:package.json',
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

  withSidebar('a second commit adds its own finding, and the first keeps its entry, its note and its closing', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.files.add(`${ROOT}/Cargo.lock`)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    // The second commit leaves Cargo.lock out and package-lock.json alone.
    w.names = 'M\tCargo.toml\n'
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m serde' })).context?.[0]).toContain('Cargo.toml but not Cargo.lock')
    expect(bar.sections.map(s => s.key)).toEqual(['package.json', 'Cargo.toml'])
    expect(bar.cleared).toEqual([])
    await $.command.run(run('mode deny'))
    const deny = (await $.tool.call({ tool: 'Bash', command: 'git push' })).deny ?? ''
    expect(deny).toContain('package-lock.json behind package.json')
    expect(deny).toContain('Cargo.lock behind Cargo.toml')
    // The third commit brings package-lock.json: the first finding closes alone, the second stands.
    w.names = 'M\tpackage-lock.json\n'
    w.next = 'ddd'
    w.staged = ['package-lock.json']
    await $.tool.call({ tool: 'Bash', command: 'git commit -m lock' })
    expect(bar.cleared).toEqual(['package.json'])
    expect(bar.sections.at(-1)).toEqual({ key: 'package.json', title: 'lockfiles updated', lines: ['package-lock.json now matches package.json'] })
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · Cargo.lock still behind')
  })

  test('the transcript reads the closed finding when the sidebar is not there', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    w.names = 'M\tpackage-lock.json\n'
    w.next = 'ccc'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m lock' })
    expect(w.logs[1]).toBe('a later change brought the lockfiles along: package-lock.json')
  })

  test('a manifest whose dependency change was reverted closes its finding', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    await $.command.run(run('mode deny'))
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toContain('package-lock.json behind package.json')
    // The manifest reads as it did at the commit that last wrote the lockfile: nothing asks for one now.
    w.sinceLock = ''
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the dependencies match the lockfile again: package.json')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · no lockfile is open')
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
    expect(w.logs.at(-1)).toBe('a later change brought the lockfiles along: package-lock.json')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('a commit that holds none of the open manifests runs, and a push still stops', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    await $.command.run(run('mode deny'))
    // The index holds another file: the pair stands, and the commit runs.
    w.staged = ['README.md']
    w.names = 'M\tREADME.md\n'
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m docs' })).deny).toBe(undefined)
    expect(w.logs).toContain('1 lockfile(s) are still behind their manifest, and this command holds none of those manifests')
    // A push holds no index, so every pair stands there.
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toContain('package-lock.json behind package.json')
    // The index holds the manifest now: the commit stops.
    w.staged = ['package.json']
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })).deny).toContain('package-lock.json behind package.json')
    // A `git commit -a` stages as it runs, so the index does not say what it holds and nothing is narrowed.
    w.staged = ['README.md']
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -am wip' })).deny).toContain('package-lock.json behind package.json')
  })

  test('the turn end measures the open pair again and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    const notes: string[][] = []
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    on('prompt.submit', (_, e) => {
      notes.push([...(e.context ?? [])])
      return { text: e.text }
    })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe("lockfile-sync: 1 lockfile(s) are still behind their manifest: package-lock.json behind package.json. Run the package manager's install so the lockfile is written, or take the dependency change back.")
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    // The package manager wrote the lockfile: the turn's end closes the finding and owes no note.
    w.lockDirty = true
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('a later change brought the lockfiles along: package-lock.json')
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('the package manager decides over the diff: in step opens nothing, behind opens the finding', async ($, on) => {
    const w = world(on)
    w.files.add(`${ROOT}/Cargo.lock`)
    w.names = 'M\tCargo.toml\n'
    // A dependency line changed, and cargo still reads the lockfile as in step: a feature that pulls in nothing.
    w.tool = ok('{}')
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m features' })).context).toBe(undefined)
    expect(w.argv).toContain(`cargo metadata --locked --format-version 1 --manifest-path ${ROOT}/Cargo.toml`)
    expect(w.argv.some(a => a.startsWith('git show HEAD:'))).toBe(false)
    w.tool = { exitCode: 101, stdout: '', stderr: 'error: cannot update the lock file /x/Cargo.lock because --locked was passed to prevent this' }
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m derive' })).context?.[0]).toContain('Cargo.toml but not Cargo.lock')
  })

  test('with the pair off HEAD in the working tree the tool is not asked, and the diff decides', async ($, on) => {
    const w = world(on)
    w.tool = ok('')
    w.treeMoved = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })).context).toEqual([NOTE])
    expect(w.argv.some(a => a.startsWith('npm '))).toBe(false)
  })

  test('an open finding closes at the turn end once the package manager reads the lockfile as in step', async ($, on) => {
    const w = world(on)
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    w.tool = ok('')
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('npm reads package-lock.json as in step with package.json')
    expect((await $.command.run(run(''))).text).toBe('on · mode note · no lockfile is open')
  })

  test('a finding its package manager reads as behind stays open even when the diff is taken back', async ($, on) => {
    const w = world(on)
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })
    w.sinceLock = ''
    w.tool = { exitCode: 1, stdout: '', stderr: 'npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.' }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await $.command.run(run(''))).text).toBe('on · mode note · package-lock.json still behind')
  })

  test('a package manager that cannot start is logged once, and the diff decides', async ($, on) => {
    const w = world(on)
    w.tool = 'throws'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m bump' })).context).toEqual([NOTE])
    w.next = 'ccc'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m again' })
    // The test engine reports a world hook that throws as a missing implementation; the host says why the tool did not start.
    expect(w.logs.filter(l => l.startsWith('npm did not run'))).toEqual(["npm did not run: no implementation for process.run; the manifest's diff decides"])
  })

  test('a git error is logged once and the commit result stays', async ($, on) => {
    const w = world(on)
    w.showFails = true
    expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).toEqual({ result: 'ok' })
    w.next = 'fff'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })
    expect(w.logs).toEqual(["the commit's lockfiles were not checked: git show --name-status HEAD failed"])
  })

  withSidebar('a commit in a directory the shell expands is not checked, and the reason is a yellow sidebar entry', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [], kinds: [] }
    seatSidebar(on, bar)
    expect(await $.tool.call({ tool: 'Bash', command: 'cd $D && git commit -m x' })).toEqual({ result: 'ok' })
    expect(bar.sections).toEqual([{ key: 'unchecked', title: 'not checked', lines: ["the commit's lockfiles were not checked: the commit's directory is not known: cd $D"] }])
    expect(bar.kinds).toEqual(['warn'])
    expect(w.logs).toEqual([])
  })
})
