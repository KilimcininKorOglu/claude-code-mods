import type { EngineInterface, Register } from 'claude-code'
import { ALL, installedOf, isNewer, logText, marketplaceOf, marketplaceText, missingText, sidebarLines, sourcesOf, statusText, versionOf, type Installed, type Mod } from './doctor.ts'

const ENABLED_KEY = 'enabled'
const MARKETPLACE_KEY = 'marketplace'

const USAGE = 'expects nothing (the status), on, off or marketplace <name | all>'

/** The section this mod owns in the shared sidebar. */
const SECTION = { consumer: 'mod-doctor', key: 'behind' }

/**
 * The on/off setting, the scope read, how many plugins are installed in it, which are behind, the home
 * directory, what was last said to the person, and whether the second measure of this session ran.
 */
type State = { enabled: boolean; scope: string; count: number; behind: Mod[]; home: string; said: string; again: boolean }

/** Where the host keeps the record of every installed plugin. */
function recordPath(home: string): string {
  return `${home}/.claude/plugins/installed_plugins.json`
}

/** Where the host keeps the clone of each marketplace. */
function clonePath(home: string, marketplace: string): string {
  return `${home}/.claude/plugins/marketplaces/${marketplace}`
}

/** A file's text, or undefined when it is missing or unreadable. */
async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return String(await $.fs.read(path))
  } catch {
    // The file is not there, or is larger than one read takes.
    return undefined
  }
}

/** The plugins installed inside the scope, or undefined when the host keeps no record of them. */
async function readInstalled($: EngineInterface, state: State): Promise<Installed[] | undefined> {
  const text = await readText($, recordPath(state.home))
  if (text === undefined) return undefined
  try {
    const mods = installedOf(text, state.scope)
    return mods.length === 0 ? undefined : mods
  } catch {
    // A record file of another shape.
    return undefined
  }
}

/**
 * Where each plugin of one marketplace sits inside its clone. The clone's own manifest is the answer,
 * because one marketplace holds its plugins under `plugins/` and another is one plugin at its root.
 */
async function readSources($: EngineInterface, state: State, marketplace: string): Promise<Map<string, string>> {
  const text = await readText($, `${clonePath(state.home, marketplace)}/.claude-plugin/marketplace.json`)
  if (text === undefined) return new Map()
  try {
    return sourcesOf(text)
  } catch {
    // A manifest of another shape.
    return new Map()
  }
}

/** The version the clone offers for one plugin, or undefined when the clone does not hold it. */
async function readOffered($: EngineInterface, state: State, mod: Installed, source: string | undefined): Promise<string | undefined> {
  if (source === undefined) return undefined
  const text = await readText($, `${clonePath(state.home, mod.marketplace)}/${source}/.claude-plugin/plugin.json`)
  if (text === undefined) return undefined
  try {
    return versionOf(text)
  } catch {
    // A manifest of another shape.
    return undefined
  }
}

/** Measures every installed plugin against its own clone; answers the ones an update is waiting for. */
async function measure($: EngineInterface, state: State): Promise<Mod[] | undefined> {
  const installed = await readInstalled($, state)
  if (installed === undefined) return undefined
  state.count = installed.length
  const sources = new Map<string, Map<string, string>>()
  const behind: Mod[] = []
  for (const mod of installed) {
    if (!sources.has(mod.marketplace)) sources.set(mod.marketplace, await readSources($, state, mod.marketplace))
    const offered = await readOffered($, state, mod, sources.get(mod.marketplace)?.get(mod.name))
    if (offered !== undefined && isNewer(offered, mod.version)) behind.push({ ...mod, installed: mod.version, offered })
  }
  behind.sort((a, b) => a.name.localeCompare(b.name))
  state.behind = behind
  return behind
}

/** What was reported last, so the same finding is not written to the transcript twice. */
function signOf(state: State): string {
  return state.behind.map(m => `${m.name}@${m.marketplace}:${m.offered}`).join(',')
}

/**
 * The finding the person reads: the sidebar while it is open, else one transcript line. The section is
 * written at every measure, because it replaces itself; the transcript line only when the finding
 * changed, so a second measure of the same finding says nothing.
 */
async function toPerson($: EngineInterface, state: State): Promise<void> {
  const lines = sidebarLines(state.behind)
  const sign = signOf(state)
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'update available', lines, until: 'session', order: 20 })) {
      state.said = sign
      return
    }
  } catch {
    // The sidebar mod is not installed.
  }
  if (state.said === sign) return
  state.said = sign
  $.ui.log(logText(state.behind))
}

/** Takes the section down, because every installed plugin is at its clone's version. */
async function clearShown($: EngineInterface, state: State): Promise<void> {
  state.said = ''
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod is not installed.
  }
}

/** Measures, then draws the finding or takes the old one down. */
async function check($: EngineInterface, state: State): Promise<void> {
  const behind = await measure($, state)
  if (behind === undefined || behind.length === 0) await clearShown($, state)
  else await toPerson($, state)
}

/** Writes the scope the person named; it holds across sessions, because it lives in $.store. */
async function setScope($: EngineInterface, state: State, arg: string): Promise<string> {
  const name = marketplaceOf(arg)
  if (name === undefined) return marketplaceText(undefined)
  state.scope = name
  await $.store.set(MARKETPLACE_KEY, name)
  await check($, state)
  return marketplaceText(name)
}

/** The stored scope, or every marketplace when nothing is stored and when the stored value is not one. */
async function readScope($: EngineInterface): Promise<string> {
  const stored = await $.store.get(MARKETPLACE_KEY)
  return typeof stored === 'string' && marketplaceOf(stored) !== undefined ? stored : ALL
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (on) await check($, state)
  else await clearShown($, state)
  return on ? 'on: the installed plugins are measured at each session start and once after the first turn' : 'off: nothing is measured'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') return setEnabled($, state, arg === 'on')
  if (arg.startsWith('marketplace')) return setScope($, state, arg.slice(11).trim())
  if (arg !== '' && arg !== 'status') return USAGE
  // The person asked, so the answer is measured now rather than read from the session's start.
  const behind = await measure($, state)
  if (behind === undefined) return missingText(state.scope)
  if (behind.length === 0) await clearShown($, state)
  else await toPerson($, state)
  return statusText(state.enabled, state.scope, state.count, behind)
}

export const register: Register = on => {
  const state: State = { enabled: true, scope: ALL, count: 0, behind: [], home: '', said: '', again: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.scope = await readScope($)
    state.home = (await $.env.get('HOME')) ?? ''
    await $.command.register({
      name: 'mod-doctor',
      description: 'Which installed plugins are behind their marketplace clone: status, on, off, marketplace <name | all> (mod-doctor)',
      argumentHint: '[on | off | marketplace <name | all>]',
      immediate: true,
    })
    // The first of the session's two measures; the second runs at the end of its first turn.
    if (state.enabled && state.home !== '') await check($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'mod-doctor' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  /*
   * One second measure, at the end of the session's first main-loop turn. It settles two cases the
   * measure at the session's start cannot: a plugin updated while this session runs, and a sidebar whose
   * own plugin had not opened its pane yet when this mod measured, where the first `set` answered false.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (state.enabled && !state.again && e.agentId === undefined && state.home !== '') {
      state.again = true
      await check($, state)
    }
    return r
  })
}
