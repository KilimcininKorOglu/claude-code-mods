/** Which git-ignored directories are build artifacts, which may be, and which hold data. */

/**
 * `certain`: a build reproduces it. `unsure`: often a build output, sometimes
 * not; listed, never preselected. `data`: never listed, never deleted.
 */
export type Class = 'certain' | 'unsure' | 'data'

/** Names that hold data no build reproduces; the directory is never listed. */
const DATA_NAMES: ReadonlySet<string> = new Set([
  'docker-data', 'data', 'training', 'dataset', 'datasets', 'models', 'uploads', 'media', 'storage',
  'db', 'database', 'pgdata', 'volumes', 'backup', 'backups', 'dump', 'dumps', 'logs', 'git-clone',
  'release', 'releases', 'artifacts', 'cache',
])

/** Names that are often build output, and sometimes a hand-made or committed directory. */
const UNSURE_NAMES: ReadonlySet<string> = new Set(['dist', 'build', 'out', 'bin', 'obj', 'vendor', '.cache', 'coverage'])

/**
 * Names a build reproduces. A name with markers is certain only when one of
 * them is inside (a `target` with no `CACHEDIR.TAG` may be anything); without
 * one it is unsure.
 */
const CERTAIN: Readonly<Record<string, readonly string[]>> = {
  node_modules: ['.package-lock.json', '.modules.yaml', '.yarn-integrity', '.yarn-state.yml'],
  target: ['CACHEDIR.TAG', '.rustc_info.json'],
  '.venv': ['pyvenv.cfg'],
  venv: ['pyvenv.cfg'],
  __pycache__: [],
  '.pytest_cache': [],
  '.mypy_cache': [],
  '.ruff_cache': [],
  '.phpunit.cache': [],
  '.next': [],
  '.nuxt': [],
  '.turbo': [],
  '.parcel-cache': [],
  '.gradle': [],
  DerivedData: [],
  Pods: [],
}

/** What a name alone says: its class, and the marker files that decide a certain one. */
export type NameRule = { cls: Class; markers: readonly string[] }

export function nameRule(name: string): NameRule | undefined {
  if (DATA_NAMES.has(name)) return { cls: 'data', markers: [] }
  const markers = CERTAIN[name]
  if (markers !== undefined) return { cls: 'certain', markers }
  return UNSURE_NAMES.has(name) ? { cls: 'unsure', markers: [] } : undefined
}

/** The class of a directory from its rule and whether one of its markers is inside. */
export function classOfRule(rule: NameRule, hasMarker: boolean): Class {
  if (rule.cls !== 'certain' || rule.markers.length === 0) return rule.cls
  return hasMarker ? 'certain' : 'unsure'
}

/** The directories in `git ls-files --others --ignored --exclude-standard --directory -z` output, without the trailing slash. */
export function ignoredDirs(output: string): string[] {
  return output.split('\0').filter(p => p.endsWith('/')).map(p => p.slice(0, -1)).filter(p => p !== '')
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `du -sk` output: kilobytes per absolute path. */
export function parseDu(output: string): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const line of output.split('\n')) {
    const m = /^(\d+)\t(.+)$/.exec(line)
    if (m?.[1] !== undefined && m[2] !== undefined) sizes.set(m[2], Number(m[1]))
  }
  return sizes
}

const KB_PER_MB = 1024
const KB_PER_GB = 1024 * 1024

/** `3.4 GB`, `512 MB`, `12 KB`. */
export function sizeText(kb: number): string {
  if (kb >= KB_PER_GB) return `${(kb / KB_PER_GB).toFixed(1)} GB`
  if (kb >= KB_PER_MB) return `${Math.round(kb / KB_PER_MB)} MB`
  return `${kb} KB`
}

/** At this total the status line shows the artifacts, and at the second it says so louder. */
export const WARN_KB = 5 * KB_PER_GB
export const LOUD_KB = 20 * KB_PER_GB

/** How the sidebar colours a line or a part of one. */
export type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

export const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
export const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The colour of the total in the sidebar: red over 20 GB, yellow from 5 GB; under it no line is drawn. */
export function statusTone(totalKb: number): 'warn' | 'error' {
  return totalKb >= LOUD_KB ? 'error' : 'warn'
}

/** The status line for a total in parts, only the size coloured and the command faint, or undefined under 5 GB. */
export function statusLine(totalKb: number): Line | undefined {
  if (totalKb < WARN_KB) return undefined
  const head = totalKb >= LOUD_KB ? 'over 20 GB: artifacts ' : 'artifacts '
  return partsLine([part(head, undefined), part(sizeText(totalKb), statusTone(totalKb)), part(' · /disk-janitor', 'dim')])
}

/** The status line for a total, or undefined under 5 GB. */
export function statusText(totalKb: number): string | undefined {
  return statusLine(totalKb)?.text
}
