/** The lines the user reads about a scan and a deletion. */
import { sizeText } from './classify.ts'
import type { Found, Scan } from './scan.ts'

export function totalKb(scan: Scan): number {
  let total = 0
  for (const kb of scan.sizes.values()) total += kb
  return total
}

/** One pane or list row: `node_modules  1.2 GB  (unsure)`. */
export function rowText(scan: Scan, f: Found): string {
  return `${f.path}  ${sizeText(scan.sizes.get(f.path) ?? 0)}${f.cls === 'unsure' ? '  (unsure)' : ''}`
}

/** What happened to each directory the user picked. */
export type Outcome = { deleted: string[]; skipped: string[]; failed: string[]; freedKb: number }

/**
 * The transcript line after a deletion; the data directories are named, because
 * they stayed. One line: a log row draws a newline as a replacement glyph (measured on 2.1.278).
 */
export function reportText(o: Outcome, data: readonly string[]): string {
  const parts = [o.deleted.length === 0 ? 'deleted nothing' : `deleted ${o.deleted.length} dir(s), ${sizeText(o.freedKb)}: ${o.deleted.join(', ')}`]
  if (o.skipped.length > 0) parts.push(`skipped: ${o.skipped.join(', ')}`)
  if (o.failed.length > 0) parts.push(`failed: ${o.failed.join(', ')}`)
  parts.push(data.length === 0 ? 'no data directory found' : `kept, data: ${data.join(', ')}`)
  return parts.join(' · ')
}

/** The sidebar's second line after a deletion: how much went, without the names the pane holds. */
export function deletedShort(o: Outcome): string {
  const parts = [o.deleted.length === 0 ? 'deleted nothing' : `deleted ${o.deleted.length} dir(s), ${sizeText(o.freedKb)}`]
  if (o.skipped.length > 0) parts.push(`${o.skipped.length} skipped`)
  if (o.failed.length > 0) parts.push(`${o.failed.length} failed`)
  return parts.join(' · ')
}

/**
 * The picks after a new scan: a path listed before keeps the person's choice,
 * a new one starts picked when it is certain.
 */
export function carriedSelection(before: Scan | undefined, selected: ReadonlySet<string>, after: Scan | undefined): Set<string> {
  const known = new Set(before?.found.map(f => f.path) ?? [])
  const keep = (f: Found) => (known.has(f.path) ? selected.has(f.path) : f.cls === 'certain')
  return new Set(after?.found.filter(keep).map(f => f.path) ?? [])
}

/** The text /disk-janitor answers: every listed directory, and how to delete where the surface has no pane. */
export function listText(scan: Scan | undefined): string {
  if (scan === undefined) return 'not measured yet, or not in a git repository'
  const rows = scan.found.map(f => rowText(scan, f))
  const head = `${scan.root} · ${scan.found.length} artifact dir(s) · ${sizeText(totalKb(scan))}`
  const data = scan.data.length === 0 ? [] : [`kept, data: ${scan.data.join(', ')}`]
  return [head, ...rows, ...data].join('\n')
}
