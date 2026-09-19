import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

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
    w.asked = []
    await $.tool.call({ tool: 'Bash', command: 'DEP_SENTINEL_SKIP=1 npm i lodash@4.17.15' })
    expect(w.logs).toEqual(['skipped on request: lodash'])
    expect((await $.command.run(run('off'))).text).toBe('off: installs run unchecked')
    await $.tool.call({ tool: 'Bash', command: 'npm i lodash@4.17.15' })
    expect(w.asked).toEqual([])
    expect(w.ran).toEqual(['npm i lodash', 'DEP_SENTINEL_SKIP=1 npm i lodash@4.17.15', 'npm i lodash@4.17.15'])
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })
})
