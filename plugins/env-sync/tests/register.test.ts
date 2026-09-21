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
  command: 'env-sync', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const DIFF = '+++ b/src/pay.ts\n@@ -0,0 +1,2 @@\n+const k = process.env.STRIPE_KEY\n+const d = process.env.DB_URL\n'

/** The committed file as it sits on disk, the source every finding is measured against. */
const PAY = `${ROOT}/src/pay.ts`
const SOURCE = 'const k = process.env.STRIPE_KEY\nconst d = process.env.DB_URL\n'

/**
 * `head` moves to `next` when the commit runs; `files` are the files on disk; `showFails` makes git show fail;
 * `notRepo` makes the directory no repository.
 */
type World = { head: string; next: string; files: Map<string, string>; argv: string[]; logs: string[]; commitFails: boolean; showFails: boolean; notRepo: boolean }

function world(on: On): World {
  const w: World = {
    head: 'aaa', next: 'bbb', files: new Map([[`${ROOT}/.env.example`, 'DB_URL=postgres://localhost/app\n'], [PAY, SOURCE]]),
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
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    expect(bar.sections).toEqual([{ key: '.env.example', title: 'env variables .env.example lacks', lines: ['STRIPE_KEY (src/pay.ts:1)'] }])
    expect(w.logs).toEqual([])
  })

  withSidebar('a later commit that adds the variables clears the entry and writes a new one', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    w.files.set(`${ROOT}/.env.example`, 'DB_URL=postgres://localhost/app\nSTRIPE_KEY=\n')
    w.next = 'ccc'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m env' })).context).toBe(undefined)
    expect(bar.cleared).toEqual(['.env.example'])
    expect(bar.sections).toEqual([{ key: '.env.example', title: 'env variables .env.example gained', lines: ['STRIPE_KEY'] }])
  })

  test('the finding stays open while one variable is still missing', async ($, on) => {
    const w = world(on)
    w.files = new Map([[`${ROOT}/.env.example`, ''], [PAY, SOURCE]])
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    w.files.set(`${ROOT}/.env.example`, 'STRIPE_KEY=\n')
    w.next = 'ccc'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m half' })
    expect(w.logs).toEqual([
      'env variables .env.example lacks: STRIPE_KEY (src/pay.ts:1) · DB_URL (src/pay.ts:2)',
      'env variables .env.example lacks: DB_URL (src/pay.ts:2)',
    ])
    w.files.set(`${ROOT}/.env.example`, 'STRIPE_KEY=\nDB_URL=\n')
    w.next = 'ddd'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m rest' })
    // The closing line names what was left, because a variable the file gained earlier already left the finding.
    expect(w.logs[2]).toBe('.env.example now lists the variables it lacked: DB_URL')
  })

  test('the first commit of a repository is checked, and .env.sample is read when .env.example is missing', async ($, on) => {
    const w = world(on)
    w.head = ''
    w.files = new Map([[`${ROOT}/.env.sample`, 'export STRIPE_KEY=\n# DB_URL=\n'], [PAY, SOURCE]])
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m first' })).context).toBe(undefined)
    w.files = new Map([[`${ROOT}/.env.dist`, ''], [PAY, SOURCE]])
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
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no variable is open')
    expect(w.logs).toEqual([])
  })

  test('in deny mode a push stops while the reference file lacks a variable, and runs once it lists them', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while the reference file lacks a variable')
    const denied = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(denied.deny).toContain('stopped: .env.example still lacks 1 variable(s): STRIPE_KEY')
    expect(denied.result).toBe(undefined)
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).result).toBe('ok')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · STRIPE_KEY still missing')
    w.files.set(`${ROOT}/.env.example`, 'DB_URL=\nSTRIPE_KEY=\n')
    expect((await $.tool.call({ tool: 'Bash', command: 'git merge main' })).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('.env.example now lists the variables it lacked: STRIPE_KEY')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('the turn end measures the open variable again and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    const notes: string[][] = []
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    on('prompt.submit', (_, e) => {
      notes.push([...(e.context ?? [])])
      return { text: e.text }
    })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe('env-sync: .env.example still lacks 1 env variable(s) the code reads: STRIPE_KEY (src/pay.ts). Add them to .env.example with a placeholder value, or take the reads out.')
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    // The reference file lists it now: the turn's end closes the finding and owes no note.
    w.files.set(`${ROOT}/.env.example`, 'DB_URL=\nSTRIPE_KEY=\n')
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('.env.example now lists the variables it lacked: STRIPE_KEY')
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('a variable the code stopped reading closes the finding, and an unreadable file keeps it', async ($, on) => {
    const w = world(on)
    w.files.set(`${ROOT}/.env.example`, '')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m pay' })
    await $.command.run(run('mode deny'))
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toContain('STRIPE_KEY · DB_URL')
    // The file reads one of them now, and nothing reads the other.
    w.files.set(PAY, 'const d = process.env.DB_URL\n')
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toContain('1 variable(s): DB_URL')
    // The file is gone: nothing reads either, so the finding closes and the gate opens.
    w.files.delete(PAY)
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the code no longer reads: DB_URL')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · no variable is open')
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
