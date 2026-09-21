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
}

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'sql-concat-watch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
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

const QUERY = 'const q = "SELECT * FROM users WHERE id = " + id'

const edit = ($: Engine, file: string, before: string, after: string) =>
  $.tool.call({ tool: 'Edit', file_path: `${ROOT}/${file}`, old_string: before, new_string: after } as never)

describe('sql-concat-watch', () => {
  test('an edit that joins SQL gets the note with the line in the file', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `import db from './db'\n\n${QUERY}\nexport const find = (id: string) => db.query(\`SELECT * FROM users WHERE id = \${id}\`)\n`
    expect((await edit($, 'src/users.ts', 'const q = ""', QUERY)).context).toEqual([
      'sql-concat-watch: this edit builds SQL from strings: src/users.ts:3. Pass values as query parameters (?, $1, :name) instead of joining them into the SQL text.',
    ])
    expect(w.logs).toEqual(['SQL built from strings: src/users.ts:3'])
    // The Edit's text is only part of line 4.
    expect((await edit($, 'src/users.ts', "db.query('SELECT 1')", 'db.query(`SELECT * FROM users WHERE id = ${id}`)')).context?.[0]).toContain('src/users.ts:4.')
  })

  withSidebar('an open sidebar takes the places and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    w.file = `${QUERY}\n`
    await edit($, 'src/users.ts', 'const q = ""', QUERY)
    expect(bar.sections).toEqual([{ key: 'src-users.ts', lines: ['src/users.ts:1'] }])
    expect(w.logs).toEqual([])
  })

  test('a Write is numbered from its own content, without a read', async ($, on) => {
    const w = world(on)
    await started($)
    const r = await $.tool.call({ tool: 'Write', file_path: '/tmp/q.py', content: 'import db\ncur.execute(f"SELECT * FROM t WHERE a = {a}")\n' } as never)
    expect(r.context?.[0]).toContain('builds SQL from strings: /tmp/q.py:2.')
    expect(w.reads).toBe(0)
  })

  test('no note for clean SQL, a non-source file, or when off', async ($, on) => {
    world(on)
    await started($)
    expect((await edit($, 'src/a.ts', 'x', 'db.query("SELECT * FROM t WHERE id = ?", [id])')).context).toBe(undefined)
    expect((await edit($, 'README.md', 'x', QUERY)).context).toBe(undefined)
    expect((await $.command.run(run('off'))).text).toBe('off: edits are not checked')
    expect((await edit($, 'src/a.ts', 'x', QUERY)).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no file is open')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
  })

  withSidebar('a later edit that drops the joined SQL closes the finding', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    on('sidebar.clear', () => ({ value: undefined }))
    await started($)
    w.file = `${QUERY}\n`
    await edit($, 'src/users.ts', 'const q = ""', QUERY)
    w.file = 'const q = "SELECT * FROM users WHERE id = ?"\n'
    await edit($, 'src/other.ts', 'x', 'const y = 1')
    expect(bar.sections.at(-1)).toEqual({ key: 'src-users.ts', lines: ['src/users.ts', 'src/users.ts:1'] })
  })

  test('a file the code deleted closes its finding, and one that cannot be read keeps it', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `${QUERY}\n`
    await edit($, 'src/users.ts', 'const q = ""', QUERY)
    await $.command.run(run('mode deny'))
    // The file is there and unreadable: nothing is proven, so the gate holds.
    w.readFails = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)).deny).toContain('src/users.ts:1')
    w.gone = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the SQL built from strings is gone from src/users.ts: src/users.ts:1')
  })

  test('in deny mode a commit stops while a file joins SQL, and runs once the file is fixed', async ($, on) => {
    const w = world(on)
    await started($)
    w.file = `${QUERY}\n`
    await edit($, 'src/users.ts', 'const q = ""', QUERY)
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a file builds SQL from strings')
    const denied = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    expect(denied.deny).toBe('stopped: 1 place(s) build SQL from strings: src/users.ts:1. Pass the values as query parameters (?, $1, :name), then run the command again; there is no way around this gate.')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · 1 file(s) still build SQL from strings')
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' } as never)).result).toBe('ok')
    // The value is a query parameter now: the gate reads the file again and opens.
    w.file = 'const q = "SELECT * FROM users WHERE id = ?"\n'
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('the SQL built from strings is gone from src/users.ts: src/users.ts:1')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('a commit that holds none of the open files runs, and a push still stops', async ($, on) => {
    const w = world(on)
    const staged: string[] = ['src/other.ts']
    on('process.run', (_, e) => {
      const cmd = e.argv.join(' ')
      const out = cmd.includes('--show-toplevel') ? `${ROOT}\n` : staged.join('\0')
      return { value: { exitCode: 0, stdout: out, stderr: '' } }
    })
    await started($)
    w.file = `${QUERY}\n`
    await edit($, 'src/users.ts', 'const q = ""', QUERY)
    await $.command.run(run('mode deny'))
    // The index holds another file: the finding stands, and the commit runs.
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m other' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe('1 file(s) still build SQL from strings, and this command holds none of them')
    // A push holds no index, so every finding stands there.
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).deny).toContain('src/users.ts:1')
    // The index holds the file now: the commit stops.
    staged[0] = 'src/users.ts'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m fix' } as never)).deny).toContain('src/users.ts:1')
    // A `git commit -a` stages as it runs, so the index does not say what it holds and nothing is narrowed.
    staged[0] = 'src/other.ts'
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -am wip' } as never)).deny).toContain('src/users.ts:1')
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
    w.file = `${QUERY}\n`
    await edit($, 'src/users.ts', 'const q = ""', QUERY)
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe('sql-concat-watch: 1 place(s) still build SQL from strings: src/users.ts:1. Pass the values as query parameters (?, $1, :name), or take the lines out.')
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    // The value is a query parameter now: the turn's end closes the finding and owes no note.
    w.file = 'const q = "SELECT * FROM users WHERE id = ?"\n'
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('the SQL built from strings is gone from src/users.ts: src/users.ts:1')
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('a failed read leaves the line number out and is logged once', async ($, on) => {
    const w = world(on)
    await started($)
    w.readFails = true
    expect((await edit($, 'src/a.ts', 'x', QUERY)).context?.[0]).toContain('from strings: src/a.ts. Pass')
    await edit($, 'src/b.ts', 'x', QUERY)
    const read = w.logs.filter(l => l.startsWith('line numbers were left out'))
    expect(read).toHaveLength(1)
    expect(read[0]).toMatch(/^line numbers were left out, the edited file was not read: /)
  })
})
