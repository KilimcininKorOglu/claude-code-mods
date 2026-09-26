import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, TurnCompleteInput } from 'claude-code'

import { installedOf, isNewer, jumpTone, marketplaceOf, rowText, sidebarLines, sourcesOf, statusText, versionOf } from '../hooks/doctor.ts'

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

/** The record file of the host: two marketplaces of this person, and a plugin of a third. */
const RECORD = JSON.stringify({
  plugins: {
    'sidebar@kilimcininkoroglu-mods': [{ version: '0.4.1' }],
    'cache-warm@kilimcininkoroglu-mods': [{ version: '0.5.0' }],
    'turkish-native@turkish-native': [{ version: '1.0.0' }],
    'code-review@claude-plugins-official': [{ version: 'c447c320' }],
  },
})

/** Each marketplace clone's own manifest: one holds its plugins under plugins/, one is a plugin itself. */
const MANIFESTS: Record<string, string> = {
  'kilimcininkoroglu-mods': JSON.stringify({ plugins: [{ name: 'sidebar', source: './plugins/sidebar' }, { name: 'cache-warm', source: './plugins/cache-warm' }] }),
  'turkish-native': JSON.stringify({ plugins: [{ name: 'turkish-native', source: './' }] }),
  'claude-plugins-official': JSON.stringify({ plugins: [{ name: 'code-review', source: { source: 'git-subdir', url: 'https://x' } }] }),
}

/** The version each clone offers, by the path this mod reads it from, as the host normalises it. */
const CLONE: Record<string, string> = {
  'kilimcininkoroglu-mods/plugins/sidebar': '0.5.0',
  'kilimcininkoroglu-mods/plugins/cache-warm': '0.5.0',
  'turkish-native': '1.2.0',
}

/** The logged lines of the person's channel, the paths read, and the record file of this world. */
type World = { logs: string[]; reads: string[]; record: string }

function world(on: On, record: string, env: Record<string, string> = { HOME: '/Users/u' }): World {
  const w: World = { logs: [], reads: [], record }
  mock.store(on, {})
  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('fs.read', (_, e) => {
    w.reads.push(e.path)
    if (e.path.endsWith('installed_plugins.json')) return { value: w.record }
    const rest = e.path.split('/marketplaces/')[1] ?? ''
    const market = rest.split('/')[0] ?? ''
    if (e.path.endsWith('marketplace.json')) return answer(MANIFESTS[market])
    const version = CLONE[rest.slice(0, rest.length - '/.claude-plugin/plugin.json'.length)]
    return answer(version === undefined ? undefined : JSON.stringify({ version }))
  })
  return w
}

/** A file that is not in the world is read as missing, exactly as the host would answer. */
function answer(text: string | undefined): { value: string } {
  if (text === undefined) throw new Error('ENOENT')
  return { value: text }
}

const started = ($: Engine): Promise<unknown> => $.session.start({ surface: null, isInteractive: true, cwd: '/work' })

let turns = 0
const turn = (): TurnCompleteInput => ({ answer: 'done', durationMs: 1000, isAborted: false, turnId: `t${++turns}`, reason: 'answer' })

describe('mod-doctor', () => {
  test('reads the records, the manifests, the versions and the texts', () => {
    expect(installedOf(RECORD, 'all', '/work')).toHaveLength(4)
    expect(installedOf(RECORD, 'turkish-native', '/work')).toEqual([{ name: 'turkish-native', marketplace: 'turkish-native', version: '1.0.0' }])
    expect(installedOf(RECORD, 'nobody-mods', '/work')).toEqual([])
    expect(sourcesOf(MANIFESTS['turkish-native'] ?? '').get('turkish-native')).toBe('./')
    // A plugin whose source is a git subdirectory of another repository has no version on disk here.
    expect(sourcesOf(MANIFESTS['claude-plugins-official'] ?? '').size).toBe(0)
    expect(versionOf('{"version":"0.5.0"}')).toBe('0.5.0')
    expect(versionOf('{"name":"x"}')).toBe(undefined)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.5.0', '0.5.0')).toBe(false)
    expect(isNewer('1.0.0', '0.99.9')).toBe(true)
    // A marketplace that versions by commit sha never asks for an update.
    expect(isNewer('d51a9f10', 'c447c320')).toBe(false)
    expect(rowText({ name: 'sidebar', marketplace: 'my-mods', installed: '0.4.1', offered: '0.5.0' })).toBe('sidebar 0.4.1 → 0.5.0')
    for (const bad of ['', 'a b', 'a/b']) expect(marketplaceOf(bad), bad).toBe(undefined)
    expect(statusText(true, 'all', 3, [])).toBe("on · every marketplace · 3 plugin(s) installed, each at its clone's version")
  })

  test('the pane draws eight rows, counts the rest, and ends with the update command', () => {
    const mods = Array.from({ length: 10 }, (_, i) => ({ name: `m${i}`, marketplace: 'my-mods', installed: '0.1.0', offered: '0.2.0' }))
    const lines = sidebarLines(mods)
    expect(lines).toHaveLength(10)
    expect(lines[0]).toEqual({ text: 'm0 0.1.0 → 0.2.0', parts: [{ text: 'm0 ' }, { text: '0.1.0', kind: 'dim' }, { text: ' → ' }, { text: '0.2.0', kind: 'warn' }] })
    expect(lines[8]).toEqual({ text: '2 more plugin(s) behind', kind: 'dim' })
    expect(lines[9]?.text).toContain('claude plugin update m0@my-mods')
  })

  test('the offered version is red for a major jump, yellow for a minor one and green for a patch', () => {
    expect([jumpTone('1.4.2', '2.0.0'), jumpTone('0.4.1', '0.5.0'), jumpTone('0.4.1', '0.4.2'), jumpTone('0.4', '0.4.0.1')]).toEqual(['error', 'warn', 'ok', 'ok'])
  })

  test('every marketplace is read, each plugin against its own clone', async ($, on) => {
    const w = world(on, RECORD)
    await started($)
    expect(w.logs).toEqual(['2 plugin(s) are behind their clone: sidebar 0.4.1 → 0.5.0, turkish-native 1.0.0 → 1.2.0'])
    const text = (await $.command.run(run(''))).text
    expect(text).toContain('on · every marketplace · 2 of 4 plugin(s) behind')
    expect(text).toContain('claude plugin update sidebar@kilimcininkoroglu-mods turkish-native@turkish-native')
  })

  test('one marketplace alone is read when the person names it', async ($, on) => {
    world(on, RECORD)
    await started($)
    expect((await $.command.run(run('marketplace turkish-native'))).text).toBe('marketplace turkish-native: that marketplace alone is checked from now on')
    expect((await $.command.run(run(''))).text).toContain('on · turkish-native · 1 of 1 plugin(s) behind')
    expect((await $.command.run(run('marketplace all'))).text).toContain('every marketplace')
    expect((await $.command.run(run(''))).text).toContain('2 of 4 plugin(s) behind')
  })

  test("each turn's end measures again, and says a finding once", async ($, on) => {
    const w = world(on, RECORD)
    await started($)
    expect(w.logs).toHaveLength(1)
    // The same finding at the turn's end says nothing new.
    await $.turn.complete(turn())
    expect(w.logs).toHaveLength(1)
    // The person ran the update in another window while this session was open.
    const behind = w.record
    w.record = JSON.stringify({ plugins: { 'cache-warm@kilimcininkoroglu-mods': [{ version: '0.5.0' }] } })
    await $.turn.complete(turn())
    expect((await $.command.run(run(''))).text).toBe("on · every marketplace · 1 plugin(s) installed, each at its clone's version")
    // A later turn still measures: a plugin that falls behind again is said again.
    w.record = behind
    await $.turn.complete(turn())
    expect(w.logs).toHaveLength(2)
  })

  test('a scope with no installed plugin says so, and off measures nothing', async ($, on) => {
    const w = world(on, RECORD)
    await started($)
    expect((await $.command.run(run('marketplace a b'))).text).toContain('marketplace expects a name')
    await $.command.run(run('marketplace nobody-mods'))
    expect((await $.command.run(run(''))).text).toBe('no installed plugin of nobody-mods was read; the marketplace name may be another one')
    expect((await $.command.run(run('off'))).text).toBe('off: nothing is measured')
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on, off or marketplace <name | all>')
    expect(w.logs).toHaveLength(1)
  })

  test("each plugin is read from the records of this session: the user one and this project's, never another project's", async ($, on) => {
    const w = world(on, JSON.stringify({
      plugins: {
        // Another project runs the new version; this session runs the user install.
        'sidebar@kilimcininkoroglu-mods': [{ scope: 'project', version: '0.5.0', projectPath: '/other' }, { scope: 'user', version: '0.4.1' }],
        // This project pins an older version over the user install.
        'cache-warm@kilimcininkoroglu-mods': [{ scope: 'user', version: '0.5.0' }, { scope: 'project', version: '0.4.0', projectPath: '/work' }],
        // Installed for another project alone.
        'turkish-native@turkish-native': [{ scope: 'project', version: '1.0.0', projectPath: '/other' }],
      },
    }))
    await started($)
    expect(w.logs).toEqual(['2 plugin(s) are behind their clone: cache-warm 0.4.0 → 0.5.0, sidebar 0.4.1 → 0.5.0'])
  })

  test('CLAUDE_CONFIG_DIR moves the record and the clones, as it moves them for the host', async ($, on) => {
    const w = world(on, RECORD, { HOME: '/Users/u', CLAUDE_CONFIG_DIR: '/cfg' })
    await started($)
    expect(w.reads.length).toBeGreaterThan(0)
    expect(w.reads.filter(p => !p.startsWith('/cfg/plugins/'))).toEqual([])
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
