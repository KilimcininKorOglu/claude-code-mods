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

const NOW = Date.parse('2026-09-19T12:00:00Z')

const run = (args: string): CommandRunInput => ({
  command: 'dep-sentinel', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const LODASH = { 'dist-tags': { latest: '4.17.21' }, versions: { '4.17.15': {}, '4.17.21': {} }, time: { created: '2012-04-23T00:00:00Z' } }
const OSV_BAD = { vulns: [{ id: 'GHSA-29mw-wpgm-hmr9', affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] }] }

/** Registry answers by URL, the URLs asked, and what reached the shell. */
type World = { answers: Map<string, { status: number; body: unknown }>; osv: unknown; asked: string[]; ran: string[]; logs: string[]; down: boolean }

function world(on: On): World {
  const w: World = {
    answers: new Map([['https://registry.npmjs.org/lodash', { status: 200, body: LODASH }]]),
    osv: {},
    asked: [],
    ran: [],
    logs: [],
    down: false,
  }
  mock.store(on, {})
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('http.fetch', (_, e) => {
    w.asked.push(e.url)
    if (w.down) throw new Error('network unreachable')
    const hit = e.url === 'https://api.osv.dev/v1/query' ? { status: 200, body: w.osv } : w.answers.get(e.url) ?? { status: 404, body: {} }
    return { value: { status: hit.status, ok: hit.status < 300, headers: {}, text: JSON.stringify(hit.body) } }
  })
  on('tool.call', { tool: 'Bash' }, (_, e) => { w.ran.push(e.command); return { result: 'ok' } as never })
  return w
}

describe('dep-sentinel', () => {
  test('stops an old pinned version with a known vulnerability and names the latest', async ($, on) => {
    const w = world(on)
    w.osv = OSV_BAD
    const r = await $.tool.call({ tool: 'Bash', command: 'npm install lodash@4.17.15' })
    expect(r.deny).toBe('dep-sentinel stopped this install: lodash@4.17.15 (npm) is not the latest version: the latest is 4.17.21 · lodash@4.17.15 has 1 known vulnerability(ies) on OSV.dev: GHSA-29mw-wpgm-hmr9; fixed in 4.17.21. Install the latest version or the right name instead. If the user needs exactly this, tell them why, then run the same command again with the DEP_SENTINEL_SKIP=1 prefix.')
    expect(w.ran).toEqual([])
  })

  test('lets the latest version run, and stops a name no registry knows', async ($, on) => {
    const w = world(on)
    expect(await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })).toEqual({ result: 'ok' })
    expect(w.asked).toEqual(['https://registry.npmjs.org/lodash', 'https://api.osv.dev/v1/query'])
    const r = await $.tool.call({ tool: 'Bash', command: 'npm i lodash-utilz-x' })
    expect(r.deny).toMatch(/^dep-sentinel stopped this install: lodash-utilz-x \(npm\) does not exist on the registry; check the name\./)
  })

  withSidebar('an open sidebar takes the unchecked and skipped packages, and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.down = true
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    await $.tool.call({ tool: 'Bash', command: 'DEP_SENTINEL_SKIP=1 npm i lodash@4.17.15' })
    expect(bar.sections.map(s => s.key)).toEqual(['unchecked', 'skipped'])
    expect(bar.sections[1]?.lines).toEqual(['lodash'])
    expect(w.logs).toEqual([])
  })

  withSidebar('a later install that checks the package clears the entry and writes a new one', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.down = true
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    w.down = false
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    expect(bar.cleared).toEqual(['unchecked'])
    expect(bar.sections).toEqual([{ key: 'unchecked', title: 'packages checked after all', lines: ['lodash'] }])
  })

  test('the transcript reads the closed finding when the sidebar is not there', async ($, on) => {
    const w = world(on)
    w.down = true
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    w.down = false
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    expect(w.logs[1]).toBe('a later install checked the packages that stayed unchecked: lodash')
  })

  test('finds a Go module from a package path under it', async ($, on) => {
    const w = world(on)
    const base = 'https://proxy.golang.org/golang.org/x/tools'
    w.answers.set(`${base}/@latest`, { status: 200, body: { Version: 'v0.30.0', Time: '2026-01-01T00:00:00Z' } })
    w.answers.set(`${base}/@v/list`, { status: 200, body: 'v0.1.0\nv0.30.0' })
    w.answers.set(`${base}/@v/v0.1.0.info`, { status: 200, body: { Version: 'v0.1.0', Time: '2019-01-01T00:00:00Z' } })
    expect(await $.tool.call({ tool: 'Bash', command: 'go install golang.org/x/tools/cmd/goimports@latest' })).toEqual({ result: 'ok' })
    expect(w.asked[0]).toBe('https://proxy.golang.org/golang.org/x/tools/cmd/goimports/@latest')
  })

  test('a network failure lets the install run with a note; the skip prefix and off check nothing', async ($, on) => {
    const w = world(on)
    w.down = true
    const r = await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    // The test engine skips a mock that throws and rejects with its own error, so only the prefix is fixed.
    expect(r.context?.[0]).toMatch(/^dep-sentinel could not check every package, so the install ran unchecked for: lodash \(.+\)\. Tell the user\.$/)
    expect(w.logs[0]).toMatch(/^the install ran unchecked for: lodash \(.+\)$/)
    w.asked = []
    await $.tool.call({ tool: 'Bash', command: 'DEP_SENTINEL_SKIP=1 npm i lodash@4.17.15' })
    expect(w.logs.slice(1)).toEqual(['skipped on request: lodash'])
    expect((await $.command.run(run('off'))).text).toBe('off: installs run unchecked')
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash@4.17.15' })
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual(['npm i lodash', 'DEP_SENTINEL_SKIP=1 npm i lodash@4.17.15', 'npm i lodash@4.17.15'])
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or mode note | deny')
  })

  test('the gate runs the owed check itself, so the network coming back opens it', async ($, on) => {
    const w = world(on)
    w.down = true
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    await $.command.run(run('mode deny'))
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toContain('installed unchecked: lodash')
    // The registry answers now: the gate's own check closes the finding, with no second install.
    w.down = false
    w.osv = OSV_BAD
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).result).toBe('ok')
    expect(w.logs.slice(1)).toEqual([
      'the registry and OSV.dev answered for the packages that stayed unchecked: lodash',
      'the check that was owed says: lodash@4.17.21 has 1 known vulnerability(ies) on OSV.dev: GHSA-29mw-wpgm-hmr9; no fixed version is listed',
    ])
    expect((await $.command.run(run(''))).text).toContain('no package is open')
  })

  test('the turn end runs the owed check again and the next prompt carries the note', async ($, on) => {
    const w = world(on)
    const notes: string[][] = []
    on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
    on('prompt.submit', (_, e) => {
      notes.push([...(e.context ?? [])])
      return { text: e.text }
    })
    w.down = true
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    const prompt = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    // No turn has ended yet, so the model is owed nothing.
    await prompt('first')
    expect(notes[0]).toEqual([])
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await prompt('second')
    expect(notes[1]?.[0]).toBe('dep-sentinel: 1 package(s) are still installed unchecked: lodash. Run the install again so the registry and OSV.dev answer, or take the package out.')
    // One note per turn: the next prompt without a turn in between carries none.
    await prompt('third')
    expect(notes[2]).toEqual([])
    // The registry answers now: the turn's end closes the finding and owes no note.
    w.down = false
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(w.logs.at(-1)).toBe('the registry and OSV.dev answered for the packages that stayed unchecked: lodash')
    await prompt('fourth')
    expect(notes[3]).toEqual([])
  })

  test('in deny mode a commit stops while a package stayed unchecked, and runs once a later install checked it', async ($, on) => {
    const w = world(on)
    w.down = true
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    expect((await $.command.run(run('mode deny'))).text).toBe('mode deny: git commit, push and merge stop while a package stayed unchecked')
    const denied = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(denied.deny).toBe('stopped: 1 package(s) were installed unchecked: lodash. Run the install again so the registry and OSV.dev answer, then run the command again; there is no way around this gate.')
    expect((await $.command.run(run(''))).text).toBe('on · mode deny · 1 package(s) still unchecked; npm, PyPI, Go, crates.io and Packagist installs are checked')
    expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).result).toBe('ok')
    w.down = false
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash' })
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).result).toBe('ok')
    expect((await $.command.run(run('mode x'))).text).toBe('mode expects note or deny')
  })
})
