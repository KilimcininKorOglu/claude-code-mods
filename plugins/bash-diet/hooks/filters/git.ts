import { CAP_INVENTORY, CAP_LIST, CAP_WARNINGS, capped, collapseBlanks, cutLine, hasArg, linesOf, orOk, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'
import { compactDiff, splitAtDiff } from './diff.ts'

/** Options after which git prints its own compact or machine format; the filter leaves it alone. */
const STATUS_OWN_FORMAT = ['-s', '--short', '--porcelain', '-z', '--null']
const DIFF_OWN_FORMAT = ['--stat', '--numstat', '--shortstat', '--name-only', '--name-status', '--summary', '--word-diff', '--color-words', '--raw', '--check', '--dirstat', '--compact-summary', '-z', '--quiet', '--exit-code', '--no-patch', '-s']
const LOG_OWN_FORMAT = ['--oneline', '--pretty', '--format', '--graph', '-p', '--patch', '-u', '--stat', '--numstat', '--shortstat', '--name-only', '--name-status', '--raw', '-z']
const LOG_LIMIT = ['-n', '--max-count', '--since', '--after', '--until', '--before', '--author', '--grep', '-S', '-G', '-L']

/** How many commits a bare `git log` shows. */
export const LOG_DEFAULT = 10

// ---------------------------------------------------------------------------------------------- status

const SECTIONS: Record<string, string> = {
  'Changes to be committed:': 'staged:',
  'Changes not staged for commit:': 'unstaged:',
  'Untracked files:': 'untracked:',
  'Unmerged paths:': 'conflicts:',
  'Ignored files:': 'ignored:',
}

const ENTRY_KINDS: Record<string, string> = {
  'modified': 'M', 'new file': 'A', 'deleted': 'D', 'renamed': 'R', 'copied': 'C', 'typechange': 'T',
  'both modified': 'UU', 'both added': 'AA', 'both deleted': 'DD', 'added by us': 'AU', 'added by them': 'UA',
  'deleted by us': 'DU', 'deleted by them': 'UD',
}

/** In-progress states, as git words them above the file lists, and the short form kept. */
const STATES: [RegExp, string][] = [
  [/All conflicts fixed but you are still merging/, 'merge in progress, no conflicts'],
  [/You have unmerged paths/, 'merge in progress, unresolved conflicts'],
  [/currently cherry-picking/, 'cherry-pick in progress'],
  [/currently reverting/, 'revert in progress'],
  [/currently bisecting/, 'bisect in progress'],
  [/middle of an am session/, 'am session in progress'],
  [/in a sparse checkout/, 'sparse checkout enabled'],
  [/rebase in progress|currently (rebasing|editing|splitting)|^(Last command done|Next commands? to do|No commands remaining)/, 'rebase in progress'],
]

/** A hint git prints to a terminal user: `(use "git add <file>..." to update ...)`. */
const isHint = (t: string): boolean => /^\((use|create\/copy|fix conflicts|all conflicts|commit or discard)\b/.test(t) || /^no changes added to commit/.test(t) || /^nothing added to commit/.test(t)

/** `Your branch is ahead of 'origin/main' by 2 commits.` as `ahead 2`, and the other three wordings. */
function tracking(t: string): string | undefined {
  const ahead = /is ahead of '(.+)' by (\d+)/.exec(t)
  if (ahead !== null) return `ahead ${ahead[2]}`
  const behind = /is behind '(.+)' by (\d+)/.exec(t)
  if (behind !== null) return `behind ${behind[2]}`
  const diverged = /have (\d+) and (\d+) different commits/.exec(t)
  if (diverged !== null) return `ahead ${diverged[1]}, behind ${diverged[2]}`
  return /is up to date with/.test(t) ? '' : undefined
}

type Status = { head: string; track: string; states: string[]; sections: { name: string; items: string[] }[]; other: string[] }

function entry(t: string): string {
  const m = /^([a-z ]+):\s+(.*)$/.exec(t)
  const kind = m === null ? undefined : ENTRY_KINDS[m[1] ?? '']
  return kind === undefined ? t : `${kind} ${m?.[2] ?? ''}`
}

/** A line above the file lists: the branch, a detached HEAD, the tracking state or an operation in progress. */
function headerLine(s: Status, t: string): boolean {
  const head = /^On branch (.+)$/.exec(t)?.[1] ?? (t.startsWith('HEAD detached') ? t : undefined)
  if (head !== undefined) s.head = head
  const track = tracking(t)
  if (track !== undefined) s.track = track
  const state = STATES.find(([re]) => re.test(t))?.[1]
  if (state !== undefined && !s.states.includes(state)) s.states.push(state)
  return [head, track, state].some(v => v !== undefined)
}

/** One line of a long-format status into its part of the summary. */
function statusLine(s: Status, raw: string): void {
  const t = raw.trim()
  if (t === '' || isHint(t) || headerLine(s, t)) return
  if (SECTIONS[t] !== undefined) { s.sections.push({ name: SECTIONS[t] ?? t, items: [] }); return }
  if (/^\s/.test(raw)) indentedLine(s, t)
  else if (!/^(nothing to commit|Your branch|and have|\(use)/.test(t)) s.other.push(t)
}

/**
 * An indented line: a file of the open section, or, above every section, a rebase todo entry, which the
 * state line already names.
 */
function indentedLine(s: Status, t: string): void {
  s.sections[s.sections.length - 1]?.items.push(entry(t))
}

function statusFilter(text: string): FilterResult {
  const s: Status = { head: '', track: '', states: [], sections: [], other: [] }
  for (const line of linesOf(text)) statusLine(s, line)
  const top = s.head === '' ? [] : [`* ${s.head}${s.track === '' ? '' : ` [${s.track}]`}`]
  const out = [...s.states, ...top]
  let elided = false
  for (const sec of s.sections) {
    const c = capped(sec.items.map(i => `  ${i}`), CAP_INVENTORY)
    out.push(sec.name, ...c.lines)
    elided ||= c.elided
  }
  if (s.sections.length === 0) out.push('clean, nothing to commit')
  return { text: [...out, ...s.other].join('\n'), elided }
}

function status(input: { args: string[]; text: string }): FilterResult {
  return hasArg(input.args, ...STATUS_OWN_FORMAT) ? cleanup(input.text) : statusFilter(input.text)
}

// ------------------------------------------------------------------------------------------ diff, show

function diff(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, ...DIFF_OWN_FORMAT)) return cleanup(input.text)
  const d = compactDiff(linesOf(input.text))
  return { text: d.lines.join('\n'), elided: d.elided }
}

/** A commit header as `git show` prints it: the header lines kept, the message's blank lines folded. */
function show(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, ...DIFF_OWN_FORMAT, '--oneline', '--pretty', '--format')) return cleanup(input.text)
  const { head, diff: body } = splitAtDiff(linesOf(input.text))
  const d = compactDiff(body)
  const top = collapseBlanks(head.map(l => cutLine(l, 200)))
  return { text: [...top, ...d.lines].join('\n').trim(), elided: d.elided }
}

// ------------------------------------------------------------------------------------------------- log

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `Thu Sep 25 14:00:00 2026 +0300` as `2026-09-25`; anything else as it is. */
function shortDate(date: string): string {
  const m = /^\w{3} (\w{3}) (\d{1,2}) [\d:]+ (\d{4})/.exec(date.trim())
  if (m === null) return date.trim()
  const month = MONTHS.indexOf(m[1] ?? '') + 1
  return `${m[3]}-${String(month).padStart(2, '0')}-${(m[2] ?? '').padStart(2, '0')}`
}

type Commit = { hash: string; refs: string; author: string; date: string; message: string[] }

const TRAILER = /^(Signed-off-by|Co-authored-by|Reviewed-by|Acked-by|Change-Id):/i

/** A commit of the default format as `hash subject (date) <author>` and up to three body lines. */
function commitLines(c: Commit): string[] {
  const [subject = '', ...body] = c.message.filter(l => l !== '' && !TRAILER.test(l))
  const refs = c.refs === '' ? '' : ` ${c.refs}`
  const head = cutLine(`${c.hash.slice(0, 7)}${refs} ${subject} (${shortDate(c.date)}) <${c.author}>`, 160)
  const shown = body.slice(0, 3).map(l => `  ${cutLine(l, 120)}`)
  return body.length > 3 ? [head, ...shown, `  [+${body.length - 3} lines]`] : [head, ...shown]
}

function logLine(commits: Commit[], line: string): void {
  const start = /^commit ([0-9a-f]{7,40})(?: \((.*)\))?/.exec(line)
  if (start !== null) { commits.push({ hash: start[1] ?? '', refs: start[2] === undefined ? '' : `(${start[2]})`, author: '', date: '', message: [] }); return }
  const c = commits[commits.length - 1]
  if (c === undefined) return
  const author = /^Author:\s+(.*?)(?: <.*>)?$/.exec(line)
  if (author !== null) { c.author = author[1] ?? ''; return }
  if (line.startsWith('Date:')) { c.date = line.slice(5); return }
  if (line.startsWith('    ') || line === '') c.message.push(line.trim())
}

function log(input: { args: string[]; text: string }): FilterResult {
  const lines = linesOf(input.text)
  if (hasArg(input.args, ...LOG_OWN_FORMAT)) return whole(lines.map(l => cutLine(l, 120)))
  const commits: Commit[] = []
  for (const line of lines) logLine(commits, line)
  if (commits.length === 0) return cleanup(input.text)
  const out = commits.flatMap(commitLines)
  const limited = input.args.includes(`-${LOG_DEFAULT}`) && commits.length === LOG_DEFAULT
  return whole(limited ? [...out, `(the ${LOG_DEFAULT} newest commits; pass -n <count> for more)`] : out)
}

/** The limit a bare `git log` gets, unless the arguments already bound it or pick their own format. */
function logFlags(args: string[]): string[] | undefined {
  if (hasArg(args, ...LOG_OWN_FORMAT, ...LOG_LIMIT)) return undefined
  if (args.some(a => /^-\d+$/.test(a) || a.includes('..'))) return undefined
  return [`-${LOG_DEFAULT}`]
}

// ------------------------------------------------------------------------------ remote and write ops

/** Progress lines git prints while it talks to a remote. */
const PROGRESS = /^(remote: )?(Enumerating|Counting|Compressing|Writing|Receiving|Resolving|Unpacking|Delta compression|Total|Finding sources)\b|^remote:\s*$|^remote: (Counting|Compressing|Total|Enumerating)/

/** `   a1b2..c3d4  main -> main` as `main (a1b2..c3d4)`. */
const REF_UPDATE = /^\s*[+*=!-]?\s*(\S+\.\.\.?\S+|\[new (?:branch|tag)\]|\[deleted\])\s+(\S+)\s+->\s+(\S+)/

function refLine(line: string): string | undefined {
  const m = REF_UPDATE.exec(line)
  return m === null ? undefined : `${m[3]} (${m[1]})`
}

function remoteOp(verb: string) {
  return (input: { text: string; exitCode: number }): FilterResult => {
    const kept: string[] = []
    const refs: string[] = []
    for (const line of linesOf(input.text)) {
      if (PROGRESS.test(line) || /^(To|From) /.test(line)) continue
      const ref = refLine(line)
      if (ref !== undefined) refs.push(ref)
      else if (line.trim() !== '') kept.push(line)
    }
    if (input.exitCode !== 0) return whole([...kept, ...refs])
    const up = kept.some(l => /Everything up-to-date|Already up to date/.test(l))
    const head = refs.length > 0 ? [`ok ${verb} ${refs.join(', ')}`] : up ? [`ok ${verb} (up to date)`] : []
    return whole([...head, ...kept.filter(l => !/Everything up-to-date|Already up to date/.test(l))])
  }
}

/** A pull: the ref move, then `N files changed, +a -r` instead of the per-file stat bars. */
function pull(input: { text: string; exitCode: number }): FilterResult {
  const lines = linesOf(input.text).filter(l => !PROGRESS.test(l) && !/^From /.test(l) && !/^\s*\*\s+branch\s/.test(l) && refLine(l) === undefined)
  if (input.exitCode !== 0) return whole(lines)
  const stat = lines.find(l => /\d+ files? changed/.test(l))
  const moved = lines.find(l => /^Updating [0-9a-f]+\.\.[0-9a-f]+/.test(l))
  if (lines.some(l => /Already up to date/.test(l))) return whole(['ok pull (up to date)'])
  const rest = lines.filter(l => !/^\s.*\|\s+\d+/.test(l) && l !== stat && l !== moved && !/^\s*(create|delete) mode /.test(l) && l.trim() !== 'Fast-forward')
  const summary = stat === undefined ? 'ok pull' : `ok pull ${stat.trim()}`
  return whole([moved === undefined ? summary : `${summary} (${moved.replace('Updating ', '')})`, ...rest])
}

/** `[main a1b2c3d4] message` and its stat as `ok a1b2c3d main: message` and the one stat line. */
function commit(input: { text: string; exitCode: number }): FilterResult {
  const lines = linesOf(input.text)
  const at = lines.findIndex(l => /^\[.+ [0-9a-f]{7,}\] /.test(l))
  if (input.exitCode !== 0 || at < 0) return cleanup(input.text)
  const m = /^\[(.+?)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.*)$/.exec(lines[at] ?? '')
  const stat = lines.slice(at).find(l => /\d+ files? changed/.test(l))
  const before = lines.slice(0, at).filter(l => l.trim() !== '')
  const head = m === null ? lines[at] ?? '' : `ok ${(m[2] ?? '').slice(0, 7)} ${m[1]}: ${m[3]}`
  return whole([...before, head, ...(stat === undefined ? [] : [`  ${stat.trim()}`])])
}

/** A branch list: the current branch, local ones, and remote-only branches capped. */
function branch(input: { args: string[]; text: string }): FilterResult {
  if (input.args.some(a => !a.startsWith('-')) || hasArg(input.args, '-v', '-vv', '--format', '--contains', '--merged', '--no-merged', '--show-current')) return cleanup(input.text)
  let current = ''
  const local: string[] = []
  const remote = new Set<string>()
  for (const raw of linesOf(input.text)) {
    const t = raw.trim()
    if (t.startsWith('* ')) current = t.slice(2)
    else if (t.startsWith('remotes/')) { const b = t.replace(/^remotes\/[^/]+\//, ''); if (!b.startsWith('HEAD ')) remote.add(b) }
    else if (t !== '') local.push(t)
  }
  const only = [...remote].filter(r => r !== current && !local.includes(r))
  const c = capped(only.map(r => `    ${r}`), CAP_WARNINGS)
  const tail = only.length === 0 ? [] : [`  remote-only (${only.length}):`, ...c.lines]
  return { text: [`* ${current}`, ...local.map(b => `  ${b}`), ...tail].join('\n'), elided: c.elided }
}

/** `stash@{0}: WIP on main: a1b2c3d message` as `stash@{0}: main: message`. */
function stash(input: { args: string[]; text: string; exitCode: number }): FilterResult {
  const sub = input.args.find(a => !a.startsWith('-')) ?? 'push'
  if (sub === 'show') return diff({ args: input.args, text: input.text })
  if (sub !== 'list') return checkout(input)
  const rows = linesOf(input.text).map(l => l.replace(/: (?:WIP on|On) ([^:]+): [0-9a-f]{7,} /, ': $1: '))
  const c = capped(rows, CAP_LIST)
  return { text: c.lines.join('\n'), elided: c.elided }
}

/** Status noise after a switch or a restore; the one line of what happened stays. */
function checkout(input: { text: string; exitCode: number }): FilterResult {
  if (input.exitCode !== 0) return cleanup(input.text)
  const lines = linesOf(input.text).filter(l => !isHint(l.trim()) && !/^Your branch is up to date/.test(l) && !/^\s*$/.test(l))
  return whole([orOk(lines, 'ok')])
}

// ------------------------------------------------------------------------------------------ tag, remote

/** `git tag` options that write or check a tag instead of listing. */
const TAG_WRITE = ['-a', '--annotate', '-s', '--sign', '-u', '--local-user', '-m', '--message', '-F', '--file', '-d', '--delete', '-f', '--force', '-v', '--verify']

/** `git tag` options that list, some with a value of their own (`--contains v1`). */
const TAG_LIST = ['-l', '--list', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort']

/** How many tags each end of a long list keeps. */
const TAG_ENDS = 10

/**
 * A tag list as both ends and a count: git sorts tags by name unless `--sort` says otherwise, so the
 * newest can stand at either end.
 */
function tag(input: { args: string[]; text: string }): FilterResult {
  const names = input.args.some(a => !a.startsWith('-'))
  if (hasArg(input.args, ...TAG_WRITE) || (names && !hasArg(input.args, ...TAG_LIST))) return cleanup(input.text)
  const rows = linesOf(input.text).filter(l => l.trim() !== '')
  if (rows.length <= TAG_ENDS * 2) return whole(rows)
  const between = `… +${rows.length - TAG_ENDS * 2} tags`
  return { text: [...rows.slice(0, TAG_ENDS), between, ...rows.slice(-TAG_ENDS), `${rows.length} tags`].join('\n'), elided: true }
}

/** One `git remote -v` row: `origin<TAB>https://x (fetch)`. */
const REMOTE_ROW = /^(\S+)\s+(\S+) \((fetch|push)\)$/

/** A remote's lines: one when it fetches and pushes to the same URL, else both with their role. */
function remoteLines(name: string, urls: Map<string, string>): string[] {
  const fetch = urls.get('fetch')
  const push = urls.get('push')
  if (fetch === push) return [`${name}  ${fetch ?? ''}`]
  return [...(fetch === undefined ? [] : [`${name}  ${fetch} (fetch)`]), ...(push === undefined ? [] : [`${name}  ${push} (push)`])]
}

/** `git remote -v`: the fetch and push rows of a remote as one line when they name the same URL. */
function remote(input: { args: string[]; text: string }): FilterResult {
  if (!hasArg(input.args, '-v', '--verbose') || input.args.some(a => !a.startsWith('-'))) return cleanup(input.text)
  const rows = linesOf(input.text).filter(l => l.trim() !== '').map(l => REMOTE_ROW.exec(l))
  if (rows.some(m => m === null)) return cleanup(input.text)
  const remotes = new Map<string, Map<string, string>>()
  for (const m of rows as RegExpExecArray[]) {
    const urls = remotes.get(m[1] ?? '') ?? new Map<string, string>()
    remotes.set(m[1] ?? '', urls.set(m[3] ?? '', m[2] ?? ''))
  }
  return whole([...remotes].flatMap(([name, urls]) => remoteLines(name, urls)))
}

export const GIT: FilterTable = {
  'git status': { run: status },
  'git diff': { run: diff },
  'git show': { run: show },
  'git log': { run: log, flags: logFlags },
  'git push': { run: remoteOp('push') },
  'git fetch': { run: remoteOp('fetch') },
  'git pull': { run: pull },
  'git commit': { run: commit },
  'git branch': { run: branch },
  'git stash': { run: stash },
  'git checkout': { run: checkout },
  'git switch': { run: checkout },
  'git restore': { run: checkout },
  'git add': { run: ({ text }) => cleanup(text) },
  'git worktree': { run: ({ text }) => cleanup(text) },
  'git tag': { run: tag },
  'git remote': { run: remote },
  'yadm status': { run: status },
  'yadm diff': { run: diff },
  'yadm log': { run: log, flags: logFlags },
}
