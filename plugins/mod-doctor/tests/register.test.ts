import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { installedOf, isNewer, marketplaceOf, rowText, sidebarLines, statusText, versionOf } from '../hooks/doctor.ts'

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

type Bar = { open: boolean; sections: { lines: string[] }[]; cleared: number }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string }[] }
    if (bar.open) bar.sections.push({ lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', () => { bar.cleared += 1; return { value: undefined } })
}

const run = (args: string): CommandRunInput => ({
  command: 'mod-doctor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** The record file of the host, as this mod reads it. */
const RECORD = JSON.stringify({
  plugins: {
    'sidebar@kilimcininkoroglu-mods': [{ version: '0.4.1' }],
    'cache-warm@kilimcininkoroglu-mods': [{ version: '0.5.0' }],
    'code-review@claude-plugins-official': [{ version: 'c447c320' }],
  },
})

/** The versions each marketplace clone offers, by the path this mod reads them from. */
const CLONE: Record<string, string> = {
  sidebar: '0.5.0',
  'cache-warm': '0.5.0',
}

/** The logged lines of the person's channel. */
type World = { logs: string[]; reads: string[] }

function world(on: On, record: string): World {
  const w: World = { logs: [], reads: [] }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  mock.env(on, { HOME: '/Users/u' })
  on('fs.read', (_, e) => {
    w.reads.push(e.path)
    if (e.path.endsWith('installed_plugins.json')) return { value: record }
    const mod = e.path.split('/plugins/')[2]?.split('/')[0] ?? ''
    const version = CLONE[mod]
    if (version === undefined) throw new Error('missing')
    return { value: JSON.stringify({ version }) }
  })
  return w
}

const started = ($: Engine): Promise<unknown> => $.session.start({ surface: null, isInteractive: true, cwd: '/work' })

describe('mod-doctor', () => {
  test('reads the records, the manifests, the versions and the texts', () => {
    expect([...installedOf(RECORD, 'kilimcininkoroglu-mods').keys()]).toEqual(['sidebar', 'cache-warm'])
    expect(installedOf(RECORD, 'nobody-mods').size).toBe(0)
    expect(versionOf('{"version":"0.5.0"}')).toBe('0.5.0')
    expect(versionOf('{"name":"x"}')).toBe(undefined)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.5.0', '0.5.0')).toBe(false)
    expect(isNewer('0.4.1', '0.5.0')).toBe(false)
    expect(isNewer('1.0.0', '0.99.9')).toBe(true)
    expect(rowText({ name: 'sidebar', installed: '0.4.1', offered: '0.5.0' })).toBe('sidebar 0.4.1 → 0.5.0')
    for (const bad of ['', 'a b', 'a/b']) expect(marketplaceOf(bad), bad).toBe(undefined)
    expect(statusText(true, 'my-mods', 3, [])).toBe('on · my-mods · 3 mod(s) installed, each at its clone\'s version')
  })

  test('the pane draws eight rows, counts the rest, and ends with the update command', () => {
    const mods = Array.from({ length: 10 }, (_, i) => ({ name: `m${i}`, installed: '0.1.0', offered: '0.2.0' }))
    const lines = sidebarLines('my-mods', mods)
    expect(lines).toHaveLength(10)
    expect(lines[0]).toEqual({ text: 'm0 0.1.0 → 0.2.0', kind: 'error' })
    expect(lines[8]).toEqual({ text: '2 more mod(s) behind', kind: 'dim' })
    expect(lines[9]?.text).toContain('claude plugin update m0@my-mods')
  })

  test('a mod behind its clone is named, and the one at its clone is not', async ($, on) => {
    const w = world(on, RECORD)
    await started($)
    expect(w.logs).toEqual(['1 mod(s) of kilimcininkoroglu-mods are behind their clone: sidebar 0.4.1 → 0.5.0'])
    expect(w.reads[0]).toBe('/Users/u/.claude/plugins/installed_plugins.json')
    const text = (await $.command.run(run(''))).text
    expect(text).toContain('on · kilimcininkoroglu-mods · 1 of 2 mod(s) behind')
    expect(text).toContain('claude plugin update sidebar@kilimcininkoroglu-mods')
  })

  test('another marketplace with no record says so, and off measures nothing', async ($, on) => {
    const w = world(on, RECORD)
    await started($)
    expect((await $.command.run(run('marketplace a b'))).text).toContain('marketplace expects a name')
    expect((await $.command.run(run('marketplace nobody-mods'))).text).toBe('marketplace nobody-mods: the mods of that marketplace are checked from now on')
    expect((await $.command.run(run(''))).text).toBe('no install record of nobody-mods was read; the marketplace name may be another one')
    expect((await $.command.run(run('off'))).text).toBe('off: nothing is measured')
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on, off or marketplace <name>')
    expect(w.logs).toHaveLength(1)
  })

  withSidebar('an open sidebar takes the rows and the transcript stays clean', async ($, on) => {
    const w = world(on, RECORD)
    const bar: Bar = { open: true, sections: [], cleared: 0 }
    seatSidebar(on, bar)
    await started($)
    expect(bar.sections.at(-1)?.lines[0]).toBe('sidebar 0.4.1 → 0.5.0')
    expect(w.logs).toEqual([])
    await $.command.run(run('off'))
    expect(bar.cleared).toBe(1)
  })
})
