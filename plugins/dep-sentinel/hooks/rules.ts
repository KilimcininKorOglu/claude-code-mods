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

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** The text a reason's parts make, as the deny text and the transcript line read it. */
export const textOf = (parts: readonly Part[]): string => parts.map(p => p.text).join('')

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: textOf(parts), parts })

/** One reason to stop an install, in parts, so the sidebar colours its versions and its finding. */
export type Reason = Part[]

const label = (p: Install): string => `${p.name}${p.version === undefined ? '' : `@${p.version}`} (${p.ecosystem})`

/** The package is on no registry. */
export const missingReason = (p: Install): Reason => [part(`${label(p)} `, undefined), part('does not exist on the registry', 'error'), part('; check the name', undefined)]

const isEstablished = (info: Info, now: number): boolean =>
  info.created !== undefined && now - info.created >= ESTABLISHED_MS && info.versions.length >= ESTABLISHED_VERSIONS

function lookAlikeReason(p: Install, info: Info, now: number): Reason | undefined {
  const target = lookAlike(p.ecosystem, p.name)
  if (target === undefined || isEstablished(info, now)) return undefined
  return [part(p.name, 'error'), part(' looks like the popular package ', undefined), part(target, 'ok'), part(', and it is not that package; check the name', undefined)]
}

function newReason(p: Install, info: Info, now: number): Reason | undefined {
  if (info.created === undefined || now - info.created >= NEW_PACKAGE_MS) return undefined
  const days = Math.max(0, Math.floor((now - info.created) / DAY_MS))
  return [part(`${p.name} was first published `, undefined), part(days === 0 ? 'today' : `${days} day(s) ago`, 'warn'), part(', less than 7 days ago', undefined)]
}

/** The pinned version red, the latest and the latest in its major version green. */
function oldReason(p: Install, info: Info): Reason | undefined {
  if (!p.exact || p.version === undefined || compareVersions(p.version, info.latest) >= 0) return undefined
  const inMajor = latestInMajor(info.versions, p.version)
  const same = inMajor !== undefined && inMajor !== info.latest && compareVersions(inMajor, p.version) > 0 ? [part(', the latest in its major version is ', undefined), part(inMajor, 'ok')] : []
  return [
    part(`${p.name}@`, undefined),
    part(p.version, 'error'),
    part(` (${p.ecosystem}) is not the latest version: the latest is `, undefined),
    part(info.latest, 'ok'),
    ...same,
  ]
}

/** The version that would be installed: the pinned one, else the latest. */
export const targetVersion = (p: Install, info: Info): string => (p.exact && p.version !== undefined ? p.version : info.latest)

/** The known vulnerabilities red, a fixed version green, and no fixed version yellow. */
export function vulnParts(p: Install, version: string, v: Vulns): Reason | undefined {
  if (v.ids.length === 0) return undefined
  const ids = v.ids.slice(0, 5).join(', ') + (v.ids.length > 5 ? ` and ${v.ids.length - 5} more` : '')
  const fixed = v.fixed.filter(f => compareVersions(f, version) > 0)
  const fix = fixed.length === 0 ? part('no fixed version is listed', 'warn') : part(`fixed in ${fixed.slice(-3).join(', ')}`, 'ok')
  return [part(`${p.name}@${version} `, undefined), part(`has ${v.ids.length} known vulnerability(ies)`, 'error'), part(` on OSV.dev: ${ids}; `, undefined), fix]
}

export function vulnReason(p: Install, version: string, v: Vulns): string | undefined {
  const parts = vulnParts(p, version, v)
  return parts === undefined ? undefined : textOf(parts)
}

/** The reasons the registry answer alone gives to stop the install, in parts. */
export function registryReasonParts(p: Install, info: Info, now: number): Reason[] {
  return [lookAlikeReason(p, info, now), newReason(p, info, now), oldReason(p, info)].filter((r): r is Reason => r !== undefined)
}

/** The reasons the registry answer alone gives to stop the install. */
export function registryReasons(p: Install, info: Info, now: number): string[] {
  return registryReasonParts(p, info, now).map(textOf)
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

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(names: readonly string[]): string {
  return `dep-sentinel: ${names.length} package(s) are still installed unchecked: ${names.join(' · ')}. Run the install again so the registry and OSV.dev answer, or take the package out.`
}

/** The transcript line: the unchecked packages alone, without the instruction the model reads. The engine adds the mod name. */
export function uncheckedLog(failures: readonly string[]): string {
  return `the install ran unchecked for: ${failures.join(' · ')}`
}

/** A package the check could not finish for, and why. */
export type Failure = { name: string; why: string }

/** A failure as the texts name it: `lodash (api.osv.dev answered HTTP 503)`. */
export const failureText = (f: Failure): string => `${f.name} (${f.why})`

/** One sidebar line per unchecked package, the name red and the reason faint, so the section reads as a list. */
export function failureLines(failures: readonly Failure[]): Line[] {
  return failures.map(f => partsLine([part(f.name, 'error'), part(` (${f.why})`, 'dim')]))
}

/** One sidebar line per package installed unchecked on request: yellow, because the person asked for it. */
export function skippedLines(names: readonly string[]): Line[] {
  return names.map(text => ({ text, kind: 'warn' }))
}

/** One sidebar line per reason, each coloured by its parts. */
export function reasonLines(reasons: readonly Reason[]): Line[] {
  return reasons.map(partsLine)
}

/** The transcript line of an unchecked finding a later install closed. */
export function checkedLog(names: readonly string[]): string {
  return `a later install checked the packages that stayed unchecked: ${names.join(' · ')}`
}

/** The transcript line of an unchecked finding the gate's own check closed. */
export function gateCheckedLog(names: readonly string[]): string {
  return `the registry and OSV.dev answered for the packages that stayed unchecked: ${names.join(' · ')}`
}

/** The transcript line of a package the gate's check answered for, with something to say about it. */
export function lateReasonLog(reasons: readonly string[]): string {
  return `the check that was owed says: ${reasons.join(' · ')}`
}

/** One sidebar line per package a later install checked. */
export function doneLines(names: readonly string[]): Line[] {
  return names.map(text => ({ text, kind: 'ok' }))
}
