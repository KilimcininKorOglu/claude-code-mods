/** Which commands commit, the doc lines `ripwire --doc-drift` calls stale, and which of them a commit added. */

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit` the model runs, not one it only asks about. */
const COMMIT = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+commit\b`)
const NOT_A_COMMIT = /\s(--dry-run|--help|-h)(\s|$)/

export function isCommit(command: string): boolean {
  return COMMIT.test(command) && !NOT_A_COMMIT.test(command)
}

/** A `git commit`, `git push` or `git merge` the model runs, the three the gate stops. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)

/** Whether the gate stops this command while a finding is open. */
export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !NOT_A_COMMIT.test(command)
}

/**
 * Whether the index alone says what this commit holds. A `-a` or `-am` commit stages the tracked files
 * as it runs, and a pathspec after `--` commits paths the index does not hold, so neither is narrowed.
 */
export function isNarrowable(command: string): boolean {
  const words = command.split(/\s+/)
  return !words.includes('--') && !words.some(w => w === '--all' || /^-[A-Za-z]*a/.test(w))
}

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/doc-drift-watch mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

const unquote = (word: string): string => word.replace(/^(["'])(.*)\1$/, '$2')

/**
 * A directory word joined to the one before it. A word the shell expands first (`$D`, `~`, a backquote,
 * outside single quotes) names no directory this text can tell, so it throws rather than run git in a
 * directory that is not there.
 */
function joinDir(base: string, word: string, how: string): string {
  const expands = !word.startsWith("'") && (/[$`]/.test(word) || word.startsWith('~'))
  if (expands) throw new Error(`the commit's directory is not known: ${how} ${word}`)
  const dir = unquote(word)
  return dir.startsWith('/') ? dir : `${base.replace(/\/+$/, '')}/${dir}`
}

/**
 * The directory the commit runs in: the session's directory, moved by the last `cd` before the commit and by
 * its `git -C`, because the hook reads the repository before the command's own `cd` has run.
 */
export function commitDir(command: string, cwd: string): string {
  const commit = COMMIT.exec(command)
  if (commit === null) return cwd
  const cds = [...command.slice(0, commit.index).matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g)]
  const lastCd = cds.at(-1)?.[1]
  const afterCd = lastCd === undefined ? cwd : joinDir(cwd, lastCd, 'cd')
  return [...commit[0].matchAll(/-C\s+(\S+)/g)].reduce((dir, c) => joinDir(dir, c[1] ?? '.', 'git -C'), afterCd)
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
export function identity(s: Stale): string {
  return `${s.doc}\0${s.kind}\0${s.why}\0${s.ref}`
}

/** The stale anchors of a run, grouped under the doc that holds them. */
export function byDoc(stale: readonly Stale[]): Map<string, Stale[]> {
  const docs = new Map<string, Stale[]>()
  for (const s of stale) docs.set(s.doc, [...(docs.get(s.doc) ?? []), s])
  return docs
}

/** The stale anchors after a commit that were not stale before it. */
export function addedBy(before: readonly Stale[], after: readonly Stale[]): Stale[] {
  const known = new Set(before.map(identity))
  return after.filter(s => !known.has(identity(s)))
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** What is wrong with one anchor, in parts: the stale reference red, and what now sits at a moved line yellow. */
function describeParts(s: Stale): Part[] {
  const ref = part(s.ref, 'error')
  switch (s.why) {
    case 'missing-file': return [part('points at ', undefined), ref, part(', a file that no longer exists', undefined)]
    case 'past-eof': return [part('points at ', undefined), ref, part(', past the end of that file', undefined)]
    case 'line-moved': return [part('points at ', undefined), ref, part(', where ', undefined), part(s.got ?? 'another symbol', 'warn'), part(' now sits', undefined)]
    case 'undefined': return [part('names `', undefined), ref, part('`, which the code no longer defines', undefined)]
    case 'deleted': return [part('names `', undefined), ref, part(`\`, which ${s.got ?? 'a commit'} deleted`, undefined)]
    default: return [part(`${s.why || s.kind}: `, undefined), ref]
  }
}

function describe(s: Stale): string {
  return describeParts(s).map(p => p.text).join('')
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

/** One sidebar line per stale anchor, so the section reads as a list: where it is faint, what is stale in colour. */
export function sidebarLines(added: readonly Stale[]): Line[] {
  const lines = added.slice(0, MAX_NAMED).map(s => partsLine([part(`${s.doc}:${s.line} `, 'dim'), ...describeParts(s)]))
  const rest = added.length - MAX_NAMED
  if (rest > 0) lines.push({ text: `and ${rest} more`, kind: 'dim' })
  return lines
}

/** A sidebar section key: the doc the finding belongs to, cut to what the sidebar takes. */
export function sectionKey(doc: string): string {
  return doc.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}

/** Which side closed a finding: the doc was updated, or the doc itself is gone. */
export type Closing = 'holds' | 'gone'

function closingText(doc: string, count: number, side: Closing): string {
  return side === 'gone'
    ? `${doc} is gone, and its ${count} stale line(s) with it`
    : `${doc}: ${count} doc line(s) hold again`
}

/** The transcript line of a closed finding. The engine adds the mod name. */
export function doneLog(doc: string, count: number, side: Closing): string {
  return closingText(doc, count, side)
}

/** The green sidebar line of a closed finding. */
export function doneLines(doc: string, count: number, side: Closing): Line[] {
  return [{ text: closingText(doc, count, side), kind: 'ok' }]
}

/** One `<doc>: <n>` pair per open finding, at most `MAX_NAMED` of them named and the rest counted. */
function namedDocs(open: ReadonlyMap<string, number>): string {
  const pairs = [...open].map(([doc, count]) => `${doc} (${count})`)
  const named = pairs.slice(0, MAX_NAMED)
  if (pairs.length > MAX_NAMED) named.push(`${pairs.length - MAX_NAMED} more`)
  return named.join(' · ')
}

/** What the deny says: why the command stopped. There is no bypass. */
export function denyText(open: ReadonlyMap<string, number>): string {
  return `stopped: ${open.size} doc(s) still hold stale lines: ${namedDocs(open)}. Update them and run the command again; there is no way around this gate.`
}

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(open: ReadonlyMap<string, number>): string {
  return `doc-drift-watch: ${open.size} doc(s) still hold stale lines: ${namedDocs(open)}. Update them.`
}
