import type { EngineInterface, Register } from 'claude-code'
import { DEFAULT_MARKETPLACE, installedOf, isNewer, logText, marketplaceOf, marketplaceText, missingText, sidebarLines, statusText, versionOf, type Mod } from './doctor.ts'

const ENABLED_KEY = 'enabled'
const MARKETPLACE_KEY = 'marketplace'

const USAGE = 'expects nothing (the status), on, off or marketplace <name>'

/** The section this mod owns in the shared sidebar. */
const SECTION = { consumer: 'mod-doctor', key: 'behind' }

/** The on/off setting, the marketplace read, how many of its mods are installed, and which are behind. */
type State = { enabled: boolean; marketplace: string; count: number; behind: Mod[]; home: string }

/** Where the host keeps the record of every installed plugin. */
function recordPath(home: string): string {
  return `${home}/.claude/plugins/installed_plugins.json`
}

/** Where the clone of one marketplace keeps one mod's manifest. */
function manifestPath(home: string, marketplace: string, mod: string): string {
  return `${home}/.claude/plugins/marketplaces/${marketplace}/plugins/${mod}/.claude-plugin/plugin.json`
}

/** The versions installed of the marketplace, or undefined when the host keeps no record of it. */
async function readInstalled($: EngineInterface, state: State): Promise<Map<string, string> | undefined> {
  try {
    const text = await $.fs.read(recordPath(state.home))
    const mods = installedOf(String(text), state.marketplace)
    return mods.size === 0 ? undefined : mods
  } catch {
    // No record file, or a record file of another shape.
    return undefined
  }
}

/** The version the marketplace clone offers for one mod, or undefined when the clone has no manifest. */
async function readOffered($: EngineInterface, state: State, mod: string): Promise<string | undefined> {
  try {
    return versionOf(String(await $.fs.read(manifestPath(state.home, state.marketplace, mod))))
  } catch {
    // The clone does not hold that mod, or holds a manifest of another shape.
    return undefined
  }
}

/** Measures every installed mod against the clone; answers the ones an update is waiting for. */
async function measure($: EngineInterface, state: State): Promise<Mod[] | undefined> {
  const installed = await readInstalled($, state)
  if (installed === undefined) return undefined
  state.count = installed.size
  const behind: Mod[] = []
  for (const [name, version] of installed) {
    const offered = await readOffered($, state, name)
    if (offered !== undefined && isNewer(offered, version)) behind.push({ name, installed: version, offered })
  }
  behind.sort((a, b) => a.name.localeCompare(b.name))
  state.behind = behind
  return behind
}

/** The finding the person reads: the sidebar while it is open, else one transcript line. */
async function toPerson($: EngineInterface, state: State): Promise<void> {
  const lines = sidebarLines(state.marketplace, state.behind)
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'mods behind', lines, until: 'session', order: 20 })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(logText(state.marketplace, state.behind))
}

/** Takes the section down, because every mod is at its clone's version. */
async function clearShown($: EngineInterface): Promise<void> {
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod is not installed.
  }
}

/** Measures, then draws the finding or takes the old one down. */
async function check($: EngineInterface, state: State): Promise<void> {
  const behind = await measure($, state)
  if (behind === undefined || behind.length === 0) await clearShown($)
  else await toPerson($, state)
}

/** Writes the marketplace the person named; it holds across sessions, because it lives in $.store. */
async function setMarketplace($: EngineInterface, state: State, arg: string): Promise<string> {
  const name = marketplaceOf(arg)
  if (name === undefined) return marketplaceText(undefined)
  state.marketplace = name
  await $.store.set(MARKETPLACE_KEY, name)
  await check($, state)
  return marketplaceText(name)
}

/** The stored marketplace, or the default when nothing is stored and when the stored value is not one. */
async function readMarketplace($: EngineInterface): Promise<string> {
  const stored = await $.store.get(MARKETPLACE_KEY)
  return typeof stored === 'string' && marketplaceOf(stored) !== undefined ? stored : DEFAULT_MARKETPLACE
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (on) await check($, state)
  else await clearShown($)
  return on ? 'on: the installed mods are measured at each session start' : 'off: nothing is measured'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') return setEnabled($, state, arg === 'on')
  if (arg.startsWith('marketplace')) return setMarketplace($, state, arg.slice(11).trim())
  if (arg !== '' && arg !== 'status') return USAGE
  // The person asked, so the answer is measured now rather than read from the session's start.
  const behind = await measure($, state)
  if (behind === undefined) return missingText(state.marketplace)
  if (behind.length === 0) await clearShown($)
  else await toPerson($, state)
  return statusText(state.enabled, state.marketplace, state.count, behind)
}

export const register: Register = on => {
  const state: State = { enabled: true, marketplace: DEFAULT_MARKETPLACE, count: 0, behind: [], home: '' }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.marketplace = await readMarketplace($)
    state.home = (await $.env.get('HOME')) ?? ''
    await $.command.register({
      name: 'mod-doctor',
      description: 'Which installed mods are behind their marketplace clone: status, on, off, marketplace <name> (mod-doctor)',
      argumentHint: '[on | off | marketplace <name>]',
      immediate: true,
    })
    // The record and the clone are read once per session; a mod's version does not change under a session.
    if (state.enabled && state.home !== '') await check($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'mod-doctor' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))
}
