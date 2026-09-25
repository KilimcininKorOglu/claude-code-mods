/** What is installed of each marketplace, what its clone offers, and how the two texts read. */

/** The scope the mod reads until the person names one marketplace: every marketplace the host cloned. */
export const ALL = 'all'

/** A marketplace name as the install records spell it; anything else is refused. */
const NAME = /^[A-Za-z0-9._-]+$/

/** The rows the pane draws; the rest are counted. */
export const ROWS = 8

/**
 * The directory the host keeps its plugins under: `CLAUDE_CONFIG_DIR` when it is set, as the host reads it,
 * else `~/.claude`. Empty when neither is known, and then nothing is measured.
 */
export function configDirOf(configDir: string | undefined, home: string | undefined): string {
  if (configDir !== undefined && configDir !== '') return configDir
  return home !== undefined && home !== '' ? `${home}/.claude` : ''
}

/** One plugin: where it comes from, the version installed, and the version its clone offers. */
export type Mod = { name: string; marketplace: string; installed: string; offered: string }

/** One plugin as the install record names it, before its clone was read. */
export type Installed = { name: string; marketplace: string; version: string }

/**
 * One record `installed_plugins.json` keeps per `<plugin>@<marketplace>` and scope. A project or local
 * install names its project in `projectPath`; a user install names none.
 */
type Entry = { version?: unknown; projectPath?: unknown }

/** Whether a record is in force for a session started in `cwd`: a user install, or one of its project. */
function appliesTo(entry: Entry, cwd: string): boolean {
  if (typeof entry.projectPath !== 'string') return true
  return cwd === entry.projectPath || cwd.startsWith(`${entry.projectPath}/`)
}

/**
 * The oldest version among the records in force for this session, so an old install is reported even when
 * another scope of the same plugin is up to date. A record of another project is not read.
 */
function versionIn(records: readonly Entry[], cwd: string): string | undefined {
  let oldest: string | undefined
  for (const entry of records) {
    if (!appliesTo(entry, cwd) || typeof entry.version !== 'string') continue
    if (oldest === undefined || isNewer(oldest, entry.version)) oldest = entry.version
  }
  return oldest
}

/**
 * The plugins installed, read from the install record of the host. `scope` is one marketplace's name, or
 * `all` for every one of them. `cwd` is the directory the session started in.
 */
export function installedOf(text: string, scope: string, cwd: string): Installed[] {
  const all = (JSON.parse(text) as { plugins?: Record<string, Entry[]> }).plugins ?? {}
  const out: Installed[] = []
  for (const [id, records] of Object.entries(all)) {
    const [name, marketplace] = id.split('@')
    const version = versionIn(records, cwd)
    if (name === undefined || marketplace === undefined || version === undefined) continue
    if (scope !== ALL && marketplace !== scope) continue
    out.push({ name, marketplace, version })
  }
  return out
}

/**
 * Where each plugin of one marketplace sits inside its clone, from that marketplace's own manifest. A
 * plugin whose source is not a path in the clone (a git subdirectory of another repository) is left out,
 * because its version is not on disk here.
 */
export function sourcesOf(text: string): Map<string, string> {
  const read = (JSON.parse(text) as { plugins?: unknown }).plugins
  const out = new Map<string, string>()
  if (!Array.isArray(read)) return out
  for (const one of read) {
    const { name, source } = (one ?? {}) as { name?: unknown; source?: unknown }
    if (typeof name === 'string' && typeof source === 'string') out.set(name, source)
  }
  return out
}

/** The version one `plugin.json` names, or undefined when the file does not name one. */
export function versionOf(text: string): string | undefined {
  const version = (JSON.parse(text) as { version?: unknown }).version
  return typeof version === 'string' ? version : undefined
}

/** The numbers of a version, so `0.10.0` sorts after `0.9.0` and a suffix does not decide. */
function parts(version: string): number[] {
  return version.split(/[.\-+]/).map(p => (/^\d+$/.test(p) ? Number(p) : -1))
}

/**
 * Whether `offered` is newer than `installed`, by the numbers of each part. Two versions of another
 * shape read as equal, so a version this mod cannot compare never asks for an update. A marketplace that
 * versions its plugins by commit sha therefore reports nothing.
 */
export function isNewer(offered: string, installed: string): boolean {
  const a = parts(offered)
  const b = parts(installed)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const one = a[i] ?? 0
    const two = b[i] ?? 0
    if (one !== two) return one > two
  }
  return false
}

/** The scope a `/mod-doctor marketplace <word>` argument names, or undefined when it is not one. */
export function marketplaceOf(arg: string): string | undefined {
  return arg.length > 0 && arg.length <= 64 && NAME.test(arg) ? arg : undefined
}

/** The answer of `/mod-doctor marketplace <name>`, or of an argument it cannot read. */
export function marketplaceText(name: string | undefined): string {
  if (name === undefined) return 'marketplace expects a name of 1-64 characters of letters, digits, . _ or -, or all'
  if (name === ALL) return 'marketplace all: every marketplace the host cloned is checked from now on'
  return `marketplace ${name}: that marketplace alone is checked from now on`
}

/** One row: the plugin, the version installed, and the version waiting for it. */
export function rowText(mod: Mod): string {
  return `${mod.name} ${mod.installed} → ${mod.offered}`
}

/** The commands that bring the outdated plugins up to date, as one line. */
export function fixText(mods: readonly Mod[]): string {
  return `claude plugin update ${mods.map(m => `${m.name}@${m.marketplace}`).join(' ')}`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The colour of a jump by the first part that differs: a major red, a minor yellow, a patch or later green. */
export function jumpTone(installed: string, offered: string): Tone {
  const a = parts(offered)
  const b = parts(installed)
  const at = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).find(i => (a[i] ?? 0) !== (b[i] ?? 0))
  if (at === 0) return 'error'
  return at === 1 ? 'warn' : 'ok'
}

/** One row in parts: the name, the version installed faint, and the version offered coloured by the jump. */
function rowLine(mod: Mod): Line {
  return partsLine([part(`${mod.name} `, undefined), part(mod.installed, 'dim'), part(' → ', undefined), part(mod.offered, jumpTone(mod.installed, mod.offered))])
}

/**
 * The pane's lines: one row per plugin that is behind, the update command faint under them. The rows
 * past the eighth are one faint line, so forty installed plugins still hold nine rows.
 */
export function sidebarLines(mods: readonly Mod[]): Line[] {
  const lines: Line[] = mods.slice(0, ROWS).map(rowLine)
  const rest = mods.length - ROWS
  if (rest > 0) lines.push({ text: `${rest} more plugin(s) behind`, kind: 'dim' })
  lines.push({ text: fixText(mods.slice(0, ROWS)), kind: 'dim' })
  return lines
}

/** The transcript line the person reads while the sidebar is closed. */
export function logText(mods: readonly Mod[]): string {
  return `${mods.length} plugin(s) are behind their clone: ${mods.map(rowText).join(', ')}`
}

/** How the status text names what was read. */
function scopeText(scope: string): string {
  return scope === ALL ? 'every marketplace' : scope
}

/** The `/mod-doctor` answer: the setting, the scope, and every plugin that is behind. */
export function statusText(enabled: boolean, scope: string, count: number, mods: readonly Mod[]): string {
  const seen = mods.length === 0 ? `${count} plugin(s) installed, each at its clone's version` : `${mods.length} of ${count} plugin(s) behind`
  const head = `${enabled ? 'on' : 'off'} · ${scopeText(scope)} · ${seen}`
  if (mods.length === 0) return head
  return `${head}\n${mods.map(rowText).join('\n')}\n${fixText(mods)}`
}

/** The answer when the host keeps no install record of what was asked for. */
export function missingText(scope: string): string {
  return `no installed plugin of ${scopeText(scope)} was read; the marketplace name may be another one`
}
