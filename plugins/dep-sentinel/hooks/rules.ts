/** Why an install is stopped, from what the registry and OSV.dev said, and the texts the model reads. */

import type { Install } from './parse.ts'
import { lookAlike } from './popular.ts'
import { compareVersions, latestInMajor, type Info, type Vulns } from './registry.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/** A package first published less than this long ago is refused. */
export const NEW_PACKAGE_MS = 7 * DAY_MS

/** A look-alike name is let through when the package is this old and has this many versions: squats are young or thin. */
const ESTABLISHED_MS = 365 * DAY_MS
const ESTABLISHED_VERSIONS = 10

const label = (p: Install): string => `${p.name}${p.version === undefined ? '' : `@${p.version}`} (${p.ecosystem})`

/** The package is on no registry. */
export const missingReason = (p: Install): string => `${label(p)} does not exist on the registry; check the name`

const isEstablished = (info: Info, now: number): boolean =>
  info.created !== undefined && now - info.created >= ESTABLISHED_MS && info.versions.length >= ESTABLISHED_VERSIONS

function lookAlikeReason(p: Install, info: Info, now: number): string | undefined {
  const target = lookAlike(p.ecosystem, p.name)
  if (target === undefined || isEstablished(info, now)) return undefined
  return `${p.name} looks like the popular package ${target}, and it is not that package; check the name`
}

function newReason(p: Install, info: Info, now: number): string | undefined {
  if (info.created === undefined || now - info.created >= NEW_PACKAGE_MS) return undefined
  const days = Math.max(0, Math.floor((now - info.created) / DAY_MS))
  return `${p.name} was first published ${days === 0 ? 'today' : `${days} day(s) ago`}, less than 7 days ago`
}

function oldReason(p: Install, info: Info): string | undefined {
  if (!p.exact || p.version === undefined || compareVersions(p.version, info.latest) >= 0) return undefined
  const inMajor = latestInMajor(info.versions, p.version)
  const same = inMajor !== undefined && inMajor !== info.latest && compareVersions(inMajor, p.version) > 0 ? `, the latest in its major version is ${inMajor}` : ''
  return `${label(p)} is not the latest version: the latest is ${info.latest}${same}`
}

/** The version that would be installed: the pinned one, else the latest. */
export const targetVersion = (p: Install, info: Info): string => (p.exact && p.version !== undefined ? p.version : info.latest)

export function vulnReason(p: Install, version: string, v: Vulns): string | undefined {
  if (v.ids.length === 0) return undefined
  const ids = v.ids.slice(0, 5).join(', ') + (v.ids.length > 5 ? ` and ${v.ids.length - 5} more` : '')
  const fixed = v.fixed.filter(f => compareVersions(f, version) > 0)
  const fix = fixed.length === 0 ? 'no fixed version is listed' : `fixed in ${fixed.slice(-3).join(', ')}`
  return `${p.name}@${version} has ${v.ids.length} known vulnerability(ies) on OSV.dev: ${ids}; ${fix}`
}

/** The reasons the registry answer alone gives to stop the install. */
export function registryReasons(p: Install, info: Info, now: number): string[] {
  return [lookAlikeReason(p, info, now), newReason(p, info, now), oldReason(p, info)].filter((r): r is string => r !== undefined)
}

/** The `deny` text the model reads. */
export function denyText(reasons: readonly string[]): string {
  return `dep-sentinel stopped this install: ${reasons.join(' · ')}. Install the latest version or the right name instead. If the user needs exactly this, tell them why, then run the same command again with the DEP_SENTINEL_SKIP=1 prefix.`
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the gate stops while a package stayed unchecked. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !ASKING.test(command)
}

/** The mode of the mod: a note only after an unchecked install, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/dep-sentinel mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** The gate text both the model and the person read: which packages stayed unchecked, and the one way out. */
export function gateText(names: readonly string[]): string {
  return `stopped: ${names.length} package(s) were installed unchecked: ${names.join(' · ')}. Run the install again so the registry and OSV.dev answer, then run the command again; there is no way around this gate.`
}

/** The note the model reads after an install whose check could not finish. */
export function uncheckedNote(failures: readonly string[]): string {
  return `dep-sentinel could not check every package, so the install ran unchecked for: ${failures.join(' · ')}. Tell the user.`
}

/** The transcript line: the unchecked packages alone, without the instruction the model reads. The engine adds the mod name. */
export function uncheckedLog(failures: readonly string[]): string {
  return `the install ran unchecked for: ${failures.join(' · ')}`
}

/** One sidebar line per named package, so the section reads as a list. */
export function sidebarLines(items: readonly string[]): { text: string; kind: 'error' }[] {
  return items.map(text => ({ text, kind: 'error' }))
}

/** The transcript line of an unchecked finding a later install closed. */
export function checkedLog(names: readonly string[]): string {
  return `a later install checked the packages that stayed unchecked: ${names.join(' · ')}`
}

/** One sidebar line per package a later install checked. */
export function doneLines(names: readonly string[]): { text: string; kind: 'ok' }[] {
  return names.map(text => ({ text, kind: 'ok' as const }))
}
