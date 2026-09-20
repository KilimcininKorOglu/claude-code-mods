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

/** The transcript line: the actions alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(uses: readonly Unpinned[]): string {
  return `actions by a moving ref: ${named(uses)}`
}

/** One sidebar line per action, so the section reads as a list. */
export function sidebarLines(uses: readonly Unpinned[]): { text: string; kind: 'error' }[] {
  return named(uses).split(' · ').map(text => ({ text, kind: 'error' }))
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
