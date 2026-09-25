/** Which `uses:` lines of a workflow name an action by a moving ref, and the note for them. */

/** One `uses:` line that names an action by a tag or a branch. */
export type Unpinned = {
  /** The action without its ref, for example `actions/checkout`. */
  action: string
  /** The ref as written, for example `v4` or `main`. */
  ref: string
  /** The commit the ref pointed at, when it was resolved. */
  sha?: string
}

/** At most this many actions are named in one note, and resolved over the network. */
export const MAX_NAMED = 10

const WORKFLOW = /\.github\/workflows\/[^/]+\.ya?ml$/
const ACTION_FILE = /\.github\/actions\/.+\/action\.ya?ml$/

/** Whether the path is a workflow or a composite action of this repository. */
export function isWorkflow(path: string): boolean {
  return WORKFLOW.test(path) || ACTION_FILE.test(path)
}

const USES = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)["']?/
const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/

/** A local action of the same repository, or a container image: neither has a commit to pin. */
function isExempt(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../') || value.startsWith('docker://')
}

/** The action and the ref of one `uses:` line, or undefined when the line pins a commit or is exempt. */
export function unpinnedUse(line: string): Unpinned | undefined {
  const value = USES.exec(line)?.[1]
  if (value === undefined || isExempt(value)) return undefined
  const cut = value.lastIndexOf('@')
  if (cut <= 0) return undefined
  const ref = value.slice(cut + 1)
  return SHA.test(ref) ? undefined : { action: value.slice(0, cut), ref }
}

/** Every line of `after` the `before` text did not have. */
function addedLines(before: string, after: string): string[] {
  const had = new Set(before.split('\n').map(l => l.trim()))
  return after.split('\n').filter(l => !had.has(l.trim()))
}

/** The actions this edit pins to a moving ref, each once, in the order they appear. */
export function unpinnedUses(before: string, after: string): Unpinned[] {
  const out: Unpinned[] = []
  const seen = new Set<string>()
  for (const line of addedLines(before, after)) {
    const use = unpinnedUse(line)
    const key = use === undefined ? '' : `${use.action}@${use.ref}`
    if (use === undefined || seen.has(key)) continue
    seen.add(key)
    out.push(use)
  }
  return out
}

/** The GitHub API URL that answers the commit a ref points at. */
export function commitUrl(action: string, ref: string): string {
  // A path inside a repository (`owner/repo/sub/action`) belongs to the repository's two first parts.
  const [owner = '', repo = ''] = action.split('/')
  return `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`
}

function named(uses: readonly Unpinned[]): string {
  const rows = uses.slice(0, MAX_NAMED).map(u => `${u.action}@${u.ref}${u.sha === undefined ? '' : ` → ${u.sha}`}`)
  if (uses.length > MAX_NAMED) rows.push(`${uses.length - MAX_NAMED} more`)
  return rows.join(' · ')
}

export function noteText(uses: readonly Unpinned[]): string {
  const example = uses[0]
  const how = example?.sha === undefined
    ? 'Pin each to the commit SHA of that tag, and keep the tag as a trailing comment.'
    : `Write each as the SHA with the tag as a comment, for example: uses: ${example.action}@${example.sha} # ${example.ref}`
  return `action-pin: this edit uses actions by a moving ref: ${named(uses)}. A tag or a branch can be moved to other code after a review, so a workflow with write access runs whatever it points at then. ${how}`
}

/**
 * The transcript line: the workflow and its actions, without the instruction the model reads. The engine
 * adds the mod name. The workflow is named because the person, unlike the model, did not see the edit.
 */
export function logText(file: string, uses: readonly Unpinned[]): string {
  return `${file} uses actions by a moving ref: ${named(uses)}`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** One action's row: the action in the default colour, the moving ref red, the commit it points at faint. */
function useLine(u: Unpinned): Line {
  const sha = u.sha === undefined ? [] : [part(` → ${u.sha}`, 'dim')]
  return partsLine([part(u.action, undefined), part(`@${u.ref}`, 'error'), ...sha])
}

/** The sidebar lines of a finding: the workflow, then one line per action, as the closing lines read. */
export function sidebarLines(file: string, uses: readonly Unpinned[]): Line[] {
  const rows = uses.slice(0, MAX_NAMED).map(useLine)
  if (uses.length > MAX_NAMED) rows.push({ text: `${uses.length - MAX_NAMED} more`, kind: 'dim' })
  return [{ text: file, kind: 'error' }, ...rows]
}

/**
 * `path` shown relative to `root` (the git repository the session started in, else its directory) when it is inside it. It also keys the
 * sidebar entry: an absolute path is cut at 64 characters there, so every workflow of a repository under
 * a long directory would share one key and a closing would take the other workflows' entries down.
 */
export function shownPath(path: string, root: string | undefined): string {
  if (root === undefined) return path
  const base = `${root.replace(/\/+$/, '')}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** The transcript line of a finding a later edit closed, by what closed it. */
export function doneLog(file: string, refs: readonly string[], gone = false): string {
  const what = gone ? `${file} is no longer there` : `every action of ${file} is pinned to a commit now`
  return `${what}: ${refs.join(' · ')}`
}

/** The title of a closed finding, by what closed it. */
export function doneTitle(gone: boolean): string {
  return gone ? 'workflow gone' : 'actions pinned'
}

/** The sidebar lines of a closed finding: the file, then the refs that are gone. */
export function doneLines(file: string, refs: readonly string[]): Line[] {
  return [{ text: file, kind: 'ok' }, ...refs.map(text => ({ text, kind: 'ok' as const }))]
}

/** `action@ref`, the form the finding is held and named by. */
export const refOf = (use: Unpinned): string => `${use.action}@${use.ref}`

/** The refs a file's finding holds open after a new report: the earlier ones and the new ones, each once. */
export function openRefs(before: readonly string[] | undefined, uses: readonly Unpinned[]): string[] {
  return [...new Set([...(before ?? []), ...uses.map(refOf)])]
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the gate stops while a finding is open. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !ASKING.test(command)
}

/** Whether the command is a `git commit`, the one guarded command whose own files can be measured. */
export function isCommit(command: string): boolean {
  return GUARDED.exec(command)?.[2] === 'commit'
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

/** The mode a `/action-pin mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** The deny text both the model and the person read: which refs still move, and the one way out. */
export function denyText(refs: readonly string[]): string {
  const rows = refs.slice(0, MAX_NAMED)
  if (refs.length > MAX_NAMED) rows.push(`${refs.length - MAX_NAMED} more`)
  return `stopped: ${refs.length} action(s) are used by a moving ref: ${rows.join(' · ')}. Pin each to the commit SHA of that ref, with the ref as a trailing comment, then run the command again; there is no way around this gate.`
}

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(refs: readonly string[]): string {
  const rows = refs.slice(0, MAX_NAMED)
  if (refs.length > MAX_NAMED) rows.push(`${refs.length - MAX_NAMED} more`)
  return `action-pin: ${refs.length} action(s) are still used by a moving ref: ${rows.join(' · ')}. Pin each to the commit SHA of that ref, or take the step out.`
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
