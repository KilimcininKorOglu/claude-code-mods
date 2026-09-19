/** What each registry and OSV.dev answer about a package, read into one shape. */

import type { Ecosystem, Install } from './parse.ts'

/** A package as its registry lists it: the latest stable version, every published version, and when it was first published. */
export type Info = { latest: string; versions: string[]; created?: number }

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v !== null && typeof v === 'object' ? (v as Json) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const time = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isNaN(t) ? undefined : t
}
const earliest = (times: readonly (number | undefined)[]): number | undefined => {
  const known = times.filter((t): t is number => t !== undefined)
  return known.length === 0 ? undefined : Math.min(...known)
}

/** A release without a pre-release part: `1.2.3`, `v1.2.3`, `2.0`, `1.0.post1`. */
export const isStable = (v: string): boolean => /^v?\d+(\.\d+)*(\.post\d+)?$/.test(v)

/** The numeric parts of a version, `v` and any pre-release part dropped. */
const parts = (v: string): number[] => (/^v?(\d+(?:\.\d+)*)/.exec(v)?.[1] ?? '0').split('.').map(Number)

/** Compares two versions by their numeric parts; a stable release sorts after its pre-releases. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return Number(isStable(a)) - Number(isStable(b))
}

const newest = (versions: readonly string[]): string | undefined => [...versions].sort(compareVersions).at(-1)

/** The newest stable release with the same major part as `version`, when there is one. */
export function latestInMajor(versions: readonly string[], version: string): string | undefined {
  const major = parts(version)[0]
  return newest(versions.filter(v => isStable(v) && parts(v)[0] === major))
}

/** The registry URL of a package; a Go module path is case-encoded as the proxy expects. */
export function registryUrl(p: Pick<Install, 'ecosystem' | 'name'>): string {
  const urls: Record<Ecosystem, string> = {
    npm: `https://registry.npmjs.org/${p.name.replace('/', '%2F')}`,
    PyPI: `https://pypi.org/pypi/${p.name}/json`,
    Go: `https://proxy.golang.org/${p.name.replace(/[A-Z]/g, c => `!${c.toLowerCase()}`)}/@latest`,
    'crates.io': `https://crates.io/api/v1/crates/${p.name}`,
    Packagist: `https://repo.packagist.org/p2/${p.name}.json`,
  }
  return urls[p.ecosystem]
}

export function npmInfo(json: unknown): Info | undefined {
  const doc = obj(json)
  const latest = str(obj(doc['dist-tags'])['latest'])
  if (latest === undefined) return undefined
  const created = time(obj(doc['time'])['created'])
  return { latest, versions: Object.keys(obj(doc['versions'])), ...(created === undefined ? {} : { created }) }
}

export function pypiInfo(json: unknown): Info | undefined {
  const doc = obj(json)
  const latest = str(obj(doc['info'])['version'])
  if (latest === undefined) return undefined
  const releases = Object.entries(obj(doc['releases'])).filter(([, files]) => Array.isArray(files) && files.length > 0)
  const created = earliest(releases.flatMap(([, files]) => (files as unknown[]).map(f => time(obj(f)['upload_time_iso_8601']))))
  return { latest, versions: releases.map(([v]) => v), ...(created === undefined ? {} : { created }) }
}

/** A Go module from the proxy's `@latest`, `@v/list` and the `.info` of its oldest version. */
export function goInfo(latestJson: unknown, list: string, oldestJson?: unknown): Info | undefined {
  const latest = str(obj(latestJson)['Version'])
  if (latest === undefined) return undefined
  const versions = list.split('\n').map(v => v.trim()).filter(v => v !== '')
  const created = time(obj(oldestJson ?? latestJson)['Time'])
  return { latest, versions: versions.length === 0 ? [latest] : versions, ...(created === undefined ? {} : { created }) }
}

/** The oldest version in a Go proxy `@v/list`, whose `.info` gives the first publish time. */
export const goOldest = (list: string): string | undefined => [...list.split('\n').map(v => v.trim()).filter(v => v !== '')].sort(compareVersions)[0]

export function cratesInfo(json: unknown): Info | undefined {
  const doc = obj(json)
  const crate = obj(doc['crate'])
  const latest = str(crate['max_stable_version']) ?? str(crate['max_version'])
  if (latest === undefined) return undefined
  const versions = (Array.isArray(doc['versions']) ? doc['versions'] : []).map(obj).filter(v => v['yanked'] !== true).map(v => str(v['num']) ?? '')
  const created = time(crate['created_at'])
  return { latest, versions: versions.filter(v => v !== ''), ...(created === undefined ? {} : { created }) }
}

export function packagistInfo(json: unknown, name: string): Info | undefined {
  const list = obj(obj(json)['packages'])[name]
  const releases = (Array.isArray(list) ? list : []).map(obj).map(r => ({ version: (str(r['version']) ?? '').replace(/^v/, ''), time: time(r['time']) }))
  const versions = releases.map(r => r.version).filter(v => v !== '')
  const latest = newest(versions.filter(isStable)) ?? newest(versions)
  if (latest === undefined) return undefined
  const created = earliest(releases.map(r => r.time))
  return { latest, versions, ...(created === undefined ? {} : { created }) }
}

/** The known vulnerabilities OSV.dev lists for one version, and the versions that fix them. */
export type Vulns = { ids: string[]; fixed: string[] }

export function osvVulns(json: unknown): Vulns {
  const vulns = (Array.isArray(obj(json)['vulns']) ? (obj(json)['vulns'] as unknown[]) : []).map(obj)
  const ids = vulns.map(v => str(v['id']) ?? '?')
  const events = vulns.flatMap(v => (Array.isArray(v['affected']) ? v['affected'] : []).map(obj))
    .flatMap(a => (Array.isArray(a['ranges']) ? a['ranges'] : []).map(obj))
    .flatMap(r => (Array.isArray(r['events']) ? r['events'] : []).map(obj))
  // A GIT range fixes at a commit hash, which is no version to install.
  const fixed = [...new Set(events.map(e => str(e['fixed'])).filter((f): f is string => f !== undefined && /^v?\d+\.\d+/.test(f)))].sort(compareVersions)
  return { ids, fixed }
}
