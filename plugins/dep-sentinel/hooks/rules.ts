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

/** The note the model reads after an install whose check could not finish. */
export function uncheckedNote(failures: readonly string[]): string {
  return `dep-sentinel could not check every package, so the install ran unchecked for: ${failures.join(' · ')}. Tell the user.`
}
