/** What the working tree holds at the end of a turn, and how the two texts read. */

/** Paths the texts name; the rest are counted. */
export const NAMED = 6

/** The statuses `git status --porcelain` gives a path that is only ignored or unreadable. */
const SKIP = /^!!|^\?\? \.claude\//

/**
 * The paths `git status --porcelain=v1 -z` names, staged or not. The records are NUL separated, and a
 * rename carries its old path as a second record, which is read and dropped.
 */
export function pathsOf(out: string): string[] {
  const records = out.split('\0')
  const paths: string[] = []
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] ?? ''
    // A rename or a copy spends the next record on the path it came from, however short that path is,
    // so the skip comes before any record is dropped.
    if (/^[RC]|^.[RC]/.test(record)) i += 1
    if (record.length <= 3 || SKIP.test(record)) continue
    paths.push(record.slice(3))
  }
  return [...new Set(paths)].sort()
}

/** The paths the texts name, and how many were left out. */
function shown(paths: readonly string[]): string {
  const first = paths.slice(0, NAMED).join(', ')
  const rest = paths.length - NAMED
  return rest > 0 ? `${first} and ${rest} more` : first
}

/** The note the model reads: what is uncommitted, and what to do with it. */
export function noteText(paths: readonly string[]): string {
  return `commit-cadence: the working tree holds ${paths.length} uncommitted file(s): ${shown(paths)}. Commit each piece of work that is finished and verified now, one commit per change, instead of leaving it for the end of the session. Leave out only a step that would break the tree on its own.`
}

/** The transcript line the person reads: the finding alone. The engine adds the mod name. */
export function logText(paths: readonly string[]): string {
  return `${paths.length} uncommitted file(s): ${shown(paths)}`
}

/** The line that closes the finding, once the tree holds nothing uncommitted. */
export function doneText(): string {
  return 'the working tree is clean again'
}

/** A sidebar line, as the sidebar mod's contract names it. */
type Line = { text: string; kind: 'error' | 'ok' }

export function sidebarLines(paths: readonly string[]): Line[] {
  return [{ text: logText(paths), kind: 'error' }]
}

export function doneLines(): Line[] {
  return [{ text: doneText(), kind: 'ok' }]
}

/** A sidebar section key: the subject cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'tree'
}

/** The `/commit-cadence` answer: the setting and what the tree holds right now. */
export function statusText(enabled: boolean, paths: readonly string[] | undefined): string {
  if (paths === undefined) return `${enabled ? 'on' : 'off'} · no git repository was read here`
  const tree = paths.length === 0 ? 'the working tree is clean' : logText(paths)
  return `${enabled ? 'on' : 'off'} · ${tree}`
}
