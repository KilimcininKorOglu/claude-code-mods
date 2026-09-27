import { PATH_ANCHOR_TYPES, type Anchor, type Scope, type Source } from '../hooks/shared/model.ts'
import { refused } from './errors.ts'
import { projectPath, slashes } from './paths.ts'

/** A stable identity for a plain object: its keys sorted, undefined values dropped. */
export function keyOf(value: object): string {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  return JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The items with a repeated identity dropped, first one kept. */
export function distinct<T extends object>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text === undefined || text === '' ? undefined : text
}

function normalizeAnchor(root: string | undefined, anchor: Anchor): Anchor {
  const path = trimmed(anchor.path)
  if (path !== undefined && root === undefined) throw refused('a path anchor needs the project root')
  const normalized: Anchor = {
    type: anchor.type,
    path: path === undefined || root === undefined ? undefined : projectPath(root, path),
    symbol: trimmed(anchor.symbol),
    command: trimmed(anchor.command)?.replace(/\s+/g, ' '),
    role: trimmed(anchor.role)?.toLowerCase(),
    contentHash: anchor.contentHash,
    gitBlobHash: anchor.gitBlobHash,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
  }
  return JSON.parse(JSON.stringify(normalized)) as Anchor
}

/**
 * Anchors with their paths made relative to the project root, their strings trimmed and repeats
 * dropped. A `user` memory is shared by every project, so it takes no path anchor.
 */
export function normalizeAnchors(root: string | undefined, scope: Scope, anchors: readonly Anchor[]): Anchor[] {
  if (scope === 'user') {
    const pathed = anchors.find(anchor => PATH_ANCHOR_TYPES.includes(anchor.type))
    if (pathed) throw refused(`a user memory is shared by every project, so it takes no ${pathed.type} anchor; use the project scope`)
  }
  return distinct(anchors.map(anchor => normalizeAnchor(root, anchor)))
}

/** Sources with trimmed strings and repeats dropped. */
export function normalizeSources(sources: readonly Source[]): Source[] {
  const normalized = sources.map(source => {
    const clean: Source = { ...source, path: trimmed(source.path), command: trimmed(source.command)?.replace(/\s+/g, ' ') }
    if (clean.path !== undefined) clean.path = slashes(clean.path)
    return JSON.parse(JSON.stringify(clean)) as Source
  })
  return distinct(normalized)
}
