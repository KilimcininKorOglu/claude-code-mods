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

const SHA = '08c6903cd8c0fde910a37f88322edcfb5dd907a8'

const run = (args: string): CommandRunInput => ({
  command: 'action-pin', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** `fails` makes api.github.com answer HTTP 403; `urls` holds every URL asked. */
type World = { urls: string[]; logs: string[]; fails: boolean; readFails: boolean; files: Map<string, string> }

function world(on: On): World {
  const w: World = { urls: [], logs: [], fails: false, readFails: false, files: new Map() }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('http.fetch', (_, e) => {
    w.urls.push(e.url)
    const answer = w.fails ? { status: 403, ok: false, text: 'rate limit exceeded' } : { status: 200, ok: true, text: `${SHA}\n` }
    return { value: { ...answer, headers: {}, url: e.url } } as never
  })
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (w.readFails) throw new Error('EACCES')
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }) as never)
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const edit = ($: Engine, file: string, before: string, after: string) =>
  $.tool.call({ tool: 'Edit', file_path: `${ROOT}/${file}`, old_string: before, new_string: after } as never)

const WORKFLOW = '.github/workflows/ci.yml'

describe('action-pin', () => {
  test('an edit that uses an action by a tag gets the note with the commit SHA', async ($, on) => {
    const w = world(on)
    await started($)
    const r = await edit($, WORKFLOW, '  - run: npm ci', '  - uses: actions/checkout@v4\n  - run: npm ci')
    expect(r.context?.[0]).toContain(`actions/checkout@v4 → ${SHA}`)
    expect(r.context?.[0]).toContain(`for example: uses: actions/checkout@${SHA} # v4`)
    expect(w.urls).toEqual(['https://api.github.com/repos/actions/checkout/commits/v4'])
    expect(w.logs).toEqual([`actions by a moving ref: actions/checkout@v4 → ${SHA}`])
    // The same action is not asked again in this session.
    await edit($, '.github/workflows/release.yml', '', '  - uses: actions/checkout@v4')
    expect(w.urls).toHaveLength(1)
  })

  withSidebar('an open sidebar takes the actions and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    await edit($, WORKFLOW, '', '  - uses: actions/checkout@v4')
    expect(bar.sections).toEqual([{ key: '-Users-u-app-.github-workflows-ci.yml', lines: [`actions/checkout@v4 → ${SHA}`] }])
    expect(w.logs).toEqual([])
  })

  test('no note for a pinned, local or container use, another file, or when off', async ($, on) => {
    const w = world(on)
    await started($)
    const clean = `  - uses: actions/checkout@${'a'.repeat(40)}\n  - uses: ./.github/actions/setup\n  - uses: docker://alpine:3.20`
    expect((await edit($, WORKFLOW, '', clean)).context).toBe(undefined)
    expect((await edit($, 'docker-compose.yml', '', '  - uses: actions/checkout@v4')).context).toBe(undefined)
    expect(w.urls).toEqual([])
    expect((await $.command.run(run('off'))).text).toBe('off: workflow edits are not checked')
    expect((await edit($, WORKFLOW, '', '  - uses: actions/checkout@v4')).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off · mode note · no workflow is open')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
  })

  test('in deny mode a commit stops while a ref moves, and runs once the workflow pins it', async ($, on) => {
    const w = world(on)
    await started($)
    await edit($, WORKFLOW, '', '  - uses: actions/checkout@v4')
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while an action is used by a moving ref')
    w.files.set(`${ROOT}/${WORKFLOW}`, '  - uses: actions/checkout@v4\n')
    const denied = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    expect(denied.deny).toBe('stopped: 1 action(s) are used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, with the ref as a trailing comment, then run the command again; there is no way around this gate.')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · 1 workflow(s) still use a moving ref')
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' } as never)).result).toBe('ok')
    // The workflow names the commit now: the gate reads the file again and opens.
    w.files.set(`${ROOT}/${WORKFLOW}`, `  - uses: actions/checkout@${SHA} # v4\n`)
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe(`every action of ${ROOT}/${WORKFLOW} is pinned to a commit now: actions/checkout@v4`)
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })

  test('a workflow the code deleted closes its finding, and an unreadable one keeps it', async ($, on) => {
    const w = world(on)
    await started($)
    await edit($, WORKFLOW, '', '  - uses: actions/checkout@v4')
    await $.command.run(run('mode deny'))
    // The workflow is there and unreadable: nothing is proven, so the gate holds.
    w.files.set(`${ROOT}/${WORKFLOW}`, '  - uses: actions/checkout@v4\n')
    w.readFails = true
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)).deny).toContain('actions/checkout@v4')
    w.files.delete(`${ROOT}/${WORKFLOW}`)
    w.readFails = false
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)).result).toBe('ok')
    expect(w.logs.at(-1)).toBe(`${ROOT}/${WORKFLOW} is no longer there: actions/checkout@v4`)
  })

  test('the turn end reads the open workflow again and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    const notes: string[][] = []
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    on('prompt.submit', (_, e) => {
      notes.push([...(e.context ?? [])])
      return { text: e.text }
    })
    await started($)
    await edit($, WORKFLOW, '', '  - uses: actions/checkout@v4')
    w.files.set(`${ROOT}/${WORKFLOW}`, '  - uses: actions/checkout@v4\n')
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe('action-pin: 1 action(s) are still used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, or take the step out.')
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    // The workflow names the commit now: the turn's end closes the finding and owes no note.
    w.files.set(`${ROOT}/${WORKFLOW}`, `  - uses: actions/checkout@${SHA} # v4\n`)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe(`every action of ${ROOT}/${WORKFLOW} is pinned to a commit now: actions/checkout@v4`)
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('a failed lookup keeps the note without the SHA and is logged once', async ($, on) => {
    const w = world(on)
    w.fails = true
    await started($)
    const r = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/${WORKFLOW}`, content: '  - uses: actions/cache@main' } as never)
    expect(r.context?.[0]).toContain('actions/cache@main. A tag or a branch can be moved')
    expect(r.context?.[0]).toContain('Pin each to the commit SHA of that tag')
    await edit($, WORKFLOW, '', '  - uses: actions/cache@main')
    const failures = w.logs.filter(l => l.startsWith('a commit SHA was not resolved'))
    expect(failures).toEqual(['a commit SHA was not resolved: api.github.com answered HTTP 403 for actions/cache@main'])
  })
})
