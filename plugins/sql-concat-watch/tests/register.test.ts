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

/** `file` is the edited file's text after the edit; `readFails` makes the read fail. */
type World = { file: string; readFails: boolean; reads: number; logs: string[] }

function world(on: On): World {
  const w: World = { file: '', readFails: false, reads: 0, logs: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('fs.read', () => {
    w.reads++
    if (w.readFails) throw new Error('EACCES')
    return { value: w.file } as never
  })
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
    expect((await $.command.run(run(''))).text).toBe('off')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
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
