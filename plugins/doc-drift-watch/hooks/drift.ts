/** Which commands commit, the doc lines `ripwire --doc-drift` calls stale, and which of them a commit added. */

/** A `git commit` the model runs, not one it only asks about. */
const COMMIT = /(^|[\s;&|(])git(\s+-C\s+\S+)*\s+commit\b/
const NOT_A_COMMIT = /\s(--dry-run|--help|-h)(\s|$)/

export function isCommit(command: string): boolean {
  return COMMIT.test(command) && !NOT_A_COMMIT.test(command)
}

const unquote = (word: string): string => word.replace(/^(["'])(.*)\1$/, '$2')

const joinDir = (base: string, dir: string): string => (dir.startsWith('/') ? dir : `${base.replace(/\/+$/, '')}/${dir}`)

/**
 * The directory the commit runs in: the session's directory, moved by the last `cd` before the commit and by
 * its `git -C`, because the hook reads the repository before the command's own `cd` has run.
 */
export function commitDir(command: string, cwd: string): string {
  const commit = COMMIT.exec(command)
  if (commit === null) return cwd
  const cds = [...command.slice(0, commit.index).matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g)]
  const lastCd = cds.at(-1)?.[1]
  const afterCd = lastCd === undefined ? cwd : joinDir(cwd, unquote(lastCd))
  return [...commit[0].matchAll(/-C\s+(\S+)/g)].reduce((dir, c) => joinDir(dir, unquote(c[1] ?? '.')), afterCd)
}

/** One anchor that no longer holds: the doc, its line, and what ripwire says of it. */
export type Stale = { doc: string; line: string; kind: string; why: string; ref: string; got?: string }

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
}

function anchor(doc: string, tag: string): Stale {
  const got = attr(tag, 'got')
  const ref = attr(tag, 'ref') ?? attr(tag, 'sym') ?? '?'
  return { doc, line: attr(tag, 'l') ?? '?', kind: attr(tag, 'k') ?? '', why: attr(tag, 'why') ?? '', ref, ...(got === undefined ? {} : { got }) }
}

/** Anchors whose author dated them record what was true then, so a commit cannot make them stale. */
const isLive = (tag: string): boolean => attr(tag, 'kind') !== 'dated-record'

/** The live stale anchors in `ripwire --doc-drift` output, each under the doc that holds it. */
export function parseDrift(output: string): Stale[] {
  const text = output.replace(/<!--[\s\S]*?-->/g, '')
  const stale: Stale[] = []
  for (const doc of text.matchAll(/<doc\s[^>]*>([\s\S]*?)<\/doc>/g)) {
    const path = attr(doc[0], 'p') ?? '?'
    for (const a of (doc[1] ?? '').matchAll(/<a\s[^>]*\/>/g)) if (isLive(a[0])) stale.push(anchor(path, a[0]))
  }
  return stale
}

/** The same claim across two runs; the line is left out, because an edit above it moves it. */
function identity(s: Stale): string {
  return `${s.doc}\0${s.kind}\0${s.why}\0${s.ref}`
}

/** The stale anchors after a commit that were not stale before it. */
export function addedBy(before: readonly Stale[], after: readonly Stale[]): Stale[] {
  const known = new Set(before.map(identity))
  return after.filter(s => !known.has(identity(s)))
}

function describe(s: Stale): string {
  switch (s.why) {
    case 'missing-file': return `points at ${s.ref}, a file that no longer exists`
    case 'past-eof': return `points at ${s.ref}, past the end of that file`
    case 'line-moved': return `points at ${s.ref}, where ${s.got ?? 'another symbol'} now sits`
    case 'undefined': return `names \`${s.ref}\`, which the code no longer defines`
    case 'deleted': return `names \`${s.ref}\`, which ${s.got ?? 'a commit'} deleted`
    default: return `${s.why || s.kind}: ${s.ref}`
  }
}

/** At most this many lines are named; the rest are counted. */
const MAX_NAMED = 8

function namedLines(added: readonly Stale[]): string {
  const named = added.slice(0, MAX_NAMED).map(s => `${s.doc}:${s.line} ${describe(s)}`).join(' · ')
  return added.length > MAX_NAMED ? `${named} · and ${added.length - MAX_NAMED} more` : named
}

/** The note the model reads after a commit that made doc lines stale. */
export function noteText(added: readonly Stale[]): string {
  return `doc-drift-watch: this commit made ${added.length} doc line(s) stale: ${namedLines(added)}. Update them in a follow-up commit, or tell the user why a line stays.`
}

/** The transcript line: the stale lines alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(added: readonly Stale[]): string {
  return `${added.length} doc line(s) stale: ${namedLines(added)}`
}

/** One sidebar line per stale anchor, so the section reads as a list. */
export function sidebarLines(added: readonly Stale[]): { text: string; kind: 'warn' }[] {
  const lines = added.slice(0, MAX_NAMED).map(s => ({ text: `${s.doc}:${s.line} ${describe(s)}`, kind: 'warn' as const }))
  const rest = added.length - MAX_NAMED
  if (rest > 0) lines.push({ text: `and ${rest} more`, kind: 'warn' })
  return lines
}

/** A sidebar section key: the docs of this commit, cut to what the sidebar takes. */
export function sectionKey(added: readonly Stale[]): string {
  return [...new Set(added.map(s => s.doc))].join('-').replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
