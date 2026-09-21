/** What is installed of one marketplace, what its clone offers, and how the two texts read. */

/** The marketplace the mod reads until the person names another one. */
export const DEFAULT_MARKETPLACE = 'kilimcininkoroglu-mods'

/** A marketplace name as the install records spell it; anything else is refused. */
const NAME = /^[A-Za-z0-9._-]+$/

/** The rows the pane draws; the rest are counted. */
export const ROWS = 8

/** One mod of the marketplace: the version installed, and the version its clone offers. */
export type Mod = { name: string; installed: string; offered: string }

/** One record `installed_plugins.json` keeps per `<mod>@<marketplace>`. */
type Entry = { version?: unknown }

/** The versions installed of one marketplace, read from the install records of the host. */
export function installedOf(text: string, marketplace: string): Map<string, string> {
  const out = new Map<string, string>()
  const all = (JSON.parse(text) as { plugins?: Record<string, Entry[]> }).plugins ?? {}
  for (const [id, records] of Object.entries(all)) {
    const [name, mine] = id.split('@')
    if (name === undefined || mine !== marketplace) continue
    const version = records[0]?.version
    if (typeof version === 'string') out.set(name, version)
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
 * shape read as equal, so a version this mod cannot compare never asks for an update.
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

/** A marketplace name the mod reads, or undefined when the argument is not one. */
export function marketplaceOf(arg: string): string | undefined {
  return arg.length > 0 && arg.length <= 64 && NAME.test(arg) ? arg : undefined
}

/** The answer of `/mod-doctor marketplace <name>`, or of an argument it cannot read. */
export function marketplaceText(name: string | undefined): string {
  if (name === undefined) return 'marketplace expects a name of 1-64 characters of letters, digits, . _ or -'
  return `marketplace ${name}: the mods of that marketplace are checked from now on`
}

/** One row: the mod, the version installed, and the version waiting for it. */
export function rowText(mod: Mod): string {
  return `${mod.name} ${mod.installed} → ${mod.offered}`
}

/** The commands that bring the outdated mods up to date, as one line. */
export function fixText(marketplace: string, mods: readonly Mod[]): string {
  const names = mods.map(m => `${m.name}@${marketplace}`).join(' ')
  return `claude plugin update ${names}`
}

/** A sidebar line, as the sidebar mod's contract names it. */
type Line = { text: string; kind: 'error' | 'dim' }

/**
 * The pane's lines: one red row per outdated mod, the update command faint under them. The rows past
 * the eighth are one faint line, so a marketplace of thirty mods still holds nine rows.
 */
export function sidebarLines(marketplace: string, mods: readonly Mod[]): Line[] {
  const lines: Line[] = mods.slice(0, ROWS).map(mod => ({ text: rowText(mod), kind: 'error' }))
  const rest = mods.length - ROWS
  if (rest > 0) lines.push({ text: `${rest} more mod(s) behind`, kind: 'dim' })
  lines.push({ text: fixText(marketplace, mods.slice(0, ROWS)), kind: 'dim' })
  return lines
}

/** The transcript line the person reads while the sidebar is closed. */
export function logText(marketplace: string, mods: readonly Mod[]): string {
  return `${mods.length} mod(s) of ${marketplace} are behind their clone: ${mods.map(rowText).join(', ')}`
}

/** The `/mod-doctor` answer: the setting, the marketplace, and every mod that is behind. */
export function statusText(enabled: boolean, marketplace: string, count: number, mods: readonly Mod[]): string {
  const seen = mods.length === 0 ? `${count} mod(s) installed, each at its clone's version` : `${mods.length} of ${count} mod(s) behind`
  const head = `${enabled ? 'on' : 'off'} · ${marketplace} · ${seen}`
  if (mods.length === 0) return head
  return `${head}\n${mods.map(rowText).join('\n')}\n${fixText(marketplace, mods)}`
}

/** The answer when the host keeps no install record of that marketplace. */
export function missingText(marketplace: string): string {
  return `no install record of ${marketplace} was read; the marketplace name may be another one`
}
