import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

const ROOT = '/Users/u/app'

const SHA = '08c6903cd8c0fde910a37f88322edcfb5dd907a8'

const run = (args: string): CommandRunInput => ({
  command: 'action-pin', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** `fails` makes api.github.com answer HTTP 403; `urls` holds every URL asked. */
type World = { urls: string[]; logs: string[]; fails: boolean }

function world(on: On): World {
  const w: World = { urls: [], logs: [], fails: false }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('http.fetch', (_, e) => {
    w.urls.push(e.url)
    const answer = w.fails ? { status: 403, ok: false, text: 'rate limit exceeded' } : { status: 200, ok: true, text: `${SHA}\n` }
    return { value: { ...answer, headers: {}, url: e.url } } as never
  })
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

  test('no note for a pinned, local or container use, another file, or when off', async ($, on) => {
    const w = world(on)
    await started($)
    const clean = `  - uses: actions/checkout@${'a'.repeat(40)}\n  - uses: ./.github/actions/setup\n  - uses: docker://alpine:3.20`
    expect((await edit($, WORKFLOW, '', clean)).context).toBe(undefined)
    expect((await edit($, 'docker-compose.yml', '', '  - uses: actions/checkout@v4')).context).toBe(undefined)
    expect(w.urls).toEqual([])
    expect((await $.command.run(run('off'))).text).toBe('off: workflow edits are not checked')
    expect((await edit($, WORKFLOW, '', '  - uses: actions/checkout@v4')).context).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
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
