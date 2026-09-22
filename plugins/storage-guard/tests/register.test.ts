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

type Bar = { open: boolean; sections: { key: string; lines: string[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', () => ({ value: undefined }))
}

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'storage-guard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** `file` is the edited file's text after the edit; `readFails` makes the read fail, `gone` deletes it. */
type World = { file: string; readFails: boolean; gone: boolean; reads: number; logs: string[] }

function world(on: On): World {
  const w: World = { file: '', readFails: false, gone: false, reads: 0, logs: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('fs.exists', () => ({ value: !w.gone }))
  on('fs.read', () => {
    w.reads++
    if (w.readFails) throw new Error('EACCES')
    return { value: w.file } as never
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }) as never)
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const SAVE = "localStorage.setItem('token', token)"
const READ = "const theme = sessionStorage.getItem('theme')"
const COOKIE = 'document.cookie = `token=${token}; Secure; SameSite=Lax`'

const edit = ($: Engine, file: string, before: string, after: string) =>
  $.tool.call({ tool: 'Edit', file_path: `${ROOT}/${file}`, old_string: before, new_string: after } as never)

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

describe('storage-guard', () => {
  test('an edit that adds localStorage gets the note with the line in the file', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `import { api } from './api'\n\n${SAVE}\n`
    expect((await edit($, 'src/auth.ts', 'save(token)', SAVE)).context).toEqual([
      "storage-guard: this edit stores data in the browser with localStorage or sessionStorage: src/auth.ts:3. Store it in a cookie instead (document.cookie, or the server's Set-Cookie).",
    ])
    expect(w.logs).toEqual(['browser storage instead of a cookie: src/auth.ts:3'])
  })

  test('a file outside the session directory is shown against the git repository the session started in', async ($, on) => {
    const w = world(on)
    on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('--show-toplevel') ? '/Users/u\n' : '', stderr: '' } }))
    await started($)
    w.file = `${SAVE}\n`
    await $.tool.call({ tool: 'Edit', file_path: '/Users/u/web/auth.ts', old_string: 'save(token)', new_string: SAVE } as never)
    expect(w.logs).toEqual(['browser storage instead of a cookie: web/auth.ts:1'])
  })

  withSidebar('an open sidebar takes the places and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    w.file = `${SAVE}\n`
    await edit($, 'src/auth.ts', 'save(token)', SAVE)
    expect(bar.sections).toEqual([{ key: 'src-auth.ts', lines: ['src/auth.ts:1'] }])
    expect(w.logs).toEqual([])
  })

  test('a Write is numbered from its own content without a read, and a test file is read too', async ($, on) => {
    const w = world(on)
    await started($)
    const r = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/auth.test.ts`, content: `import { it } from 'vitest'\n${READ}\n` } as never)
    expect(r.context?.[0]).toContain('localStorage or sessionStorage: src/auth.test.ts:2.')
    expect(w.reads).toBe(0)
  })

  test('no note for a cookie, a non-source file, or when off', async ($, on) => {
    world(on)
    await started($)
    expect((await edit($, 'src/a.ts', 'x', COOKIE)).context).toBe(undefined)
    expect((await edit($, 'notes.md', 'x', SAVE)).context).toBe(undefined)
    expect((await $.command.run(run('off'))).text).toBe('off: edits are not checked')
    expect((await edit($, 'src/a.ts', 'x', SAVE)).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no file is open')
    expect((await $.command.run(run('on'))).text).toBe('on: each edit is checked for localStorage and sessionStorage')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
  })

  withSidebar('a later edit that moves the data to a cookie closes the finding in green', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    w.file = `${SAVE}\n`
    await edit($, 'src/auth.ts', 'save(token)', SAVE)
    w.file = `${COOKIE}\n`
    await edit($, 'src/other.ts', 'x', 'const y = 1')
    expect(bar.sections.at(-1)).toEqual({ key: 'src-auth.ts', lines: ['src/auth.ts', 'src/auth.ts:1'] })
  })

  test('a partial fix keeps the finding open with the places the file holds now', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `${SAVE}\n${READ}\n`
    await edit($, 'src/auth.ts', 'x', `${SAVE}\n${READ}`)
    await $.command.run(run('mode deny'))
    // The save moved to a cookie and the read moved down a line: one place stands, at its new line.
    w.file = `${COOKIE}\n\n${READ}\n`
    expect((await bash($, 'git push')).deny).toBe(
      'stopped: 1 place(s) store data in localStorage or sessionStorage: src/auth.ts:3. Move the data to a cookie, then run the command again; there is no way around this gate.',
    )
    expect(w.logs.some(l => l.startsWith('the browser storage is gone'))).toBe(false)
    // A commented-out line uses nothing: the finding closes.
    w.file = `${COOKIE}\n\n// ${READ}\n`
    expect((await bash($, 'git push')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the browser storage is gone from src/auth.ts: src/auth.ts:3')
  })

  test('a file the code deleted closes its finding, and one that cannot be read keeps it', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `${SAVE}\n`
    await edit($, 'src/auth.ts', 'save(token)', SAVE)
    await $.command.run(run('mode deny'))
    // The file is there and unreadable: nothing is proven, so the gate holds.
    w.readFails = true
    expect((await bash($, 'git commit -m x')).deny).toContain('src/auth.ts:1')
    w.gone = true
    expect((await bash($, 'git commit -m x')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the browser storage is gone from src/auth.ts: src/auth.ts:1')
  })

  test('in deny mode a commit stops while a file uses the storage, and runs once the file is fixed', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `${SAVE}\n`
    await edit($, 'src/auth.ts', 'save(token)', SAVE)
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a file uses localStorage or sessionStorage')
    expect((await bash($, 'git commit -m x')).deny).toBe(
      'stopped: 1 place(s) store data in localStorage or sessionStorage: src/auth.ts:1. Move the data to a cookie, then run the command again; there is no way around this gate.',
    )
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · 1 file(s) still use localStorage or sessionStorage')
    expect((await bash($, 'git status')).result).toBe('ok')
    w.file = `${COOKIE}\n`
    expect((await bash($, 'git merge main')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the browser storage is gone from src/auth.ts: src/auth.ts:1')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
    expect((await $.command.run(run('mode note'))).text).toBe('mode note: the places are only reported')
  })

  test('a commit that holds none of the open files runs, and a push still stops', async ($, on) => {
    const w = world(on)
    const staged: string[] = ['src/other.ts']
    on('process.run', (_, e) => {
      const out = e.argv.includes('--show-toplevel') ? `${ROOT}\n` : staged.join('\0')
      return { value: { exitCode: 0, stdout: out, stderr: '' } }
    })
    await started($)
    w.file = `${SAVE}\n`
    await edit($, 'src/auth.ts', 'save(token)', SAVE)
    await $.command.run(run('mode deny'))
    // The index holds another file: the finding stands, and the commit runs.
    expect((await bash($, 'git commit -m other')).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('1 file(s) still use localStorage or sessionStorage, and this command holds none of them')
    // A push holds no index, so every finding stands there.
    expect((await bash($, 'git push')).deny).toContain('src/auth.ts:1')
    staged[0] = 'src/auth.ts'
    expect((await bash($, 'git commit -m fix')).deny).toContain('src/auth.ts:1')
    // A `git commit -a` stages as it runs, so nothing is narrowed.
    staged[0] = 'src/other.ts'
    expect((await bash($, 'git commit -am wip')).deny).toContain('src/auth.ts:1')
  })

  test('the turn end reads the open file again and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    const notes: string[][] = []
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    on('prompt.submit', (_, e) => {
      notes.push([...(e.context ?? [])])
      return { text: e.text }
    })
    await started($)
    w.file = `${SAVE}\n`
    await edit($, 'src/auth.ts', 'save(token)', SAVE)
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe('storage-guard: 1 place(s) still store data in localStorage or sessionStorage: src/auth.ts:1. Move the data to a cookie, or take the lines out.')
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    w.file = `${COOKIE}\n`
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('the browser storage is gone from src/auth.ts: src/auth.ts:1')
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('a failed read leaves the line number out and is logged once', async ($, on) => {
    const w = world(on)
    await started($)
    w.readFails = true
    expect((await edit($, 'src/a.ts', 'x', SAVE)).context?.[0]).toContain('sessionStorage: src/a.ts. Store')
    await edit($, 'src/b.ts', 'x', SAVE)
    const read = w.logs.filter(l => l.startsWith('the edited file was not read'))
    expect(read).toHaveLength(1)
  })
})
