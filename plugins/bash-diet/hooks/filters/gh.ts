import { CAP_LIST, capped, collapseBlanks, cutLine, hasArg, linesOf, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** Options after which gh prints the fields the caller asked for; the filter leaves them alone. */
const OWN_FORMAT = ['--json', '--jq', '-q', '--template', '-t', '--web', '-w']

/** How many body lines a PR or issue view keeps. */
const MAX_BODY_LINES = 60

/** Fields of a `view` header worth a line; empty ones are dropped. */
const VIEW_FIELDS = ['title', 'state', 'author', 'number', 'url', 'labels', 'reviewers', 'assignees', 'milestone', 'additions', 'deletions', 'comments']

// -------------------------------------------------------------------------------------------- markdown

const BADGE = /^\s*(\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*)+$/
const IMAGE_ONLY = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

/** Markdown outside code fences without HTML comments, badge and image-only lines and rules. */
function prose(lines: string[]): string[] {
  const text = lines.join('\n').replace(/<!--[\s\S]*?-->/g, '')
  return text.split('\n').filter(l => !BADGE.test(l) && !IMAGE_ONLY.test(l) && !RULE.test(l))
}

/** A markdown body with its noise removed; code blocks stay as they are. */
export function markdownBody(lines: string[]): string[] {
  const out: string[] = []
  let chunk: string[] = []
  let fence: string | undefined
  for (const line of lines) {
    const mark = /^\s*(```|~~~)/.exec(line)?.[1]
    if (fence === undefined && mark !== undefined) { out.push(...prose(chunk), line); chunk = []; fence = mark; continue }
    if (fence !== undefined) { out.push(line); if (mark === fence) fence = undefined; continue }
    chunk.push(line)
  }
  return collapseBlanks([...out, ...prose(chunk)])
}

// -------------------------------------------------------------------------------------------- views

/** A `gh pr view` or `gh issue view` as the header fields that say something, then the body cut. */
function view(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, ...OWN_FORMAT, '--comments', '-c')) return cleanup(input.text)
  const lines = linesOf(input.text)
  const split = lines.indexOf('--')
  if (split < 0) return cleanup(input.text)
  const head = lines.slice(0, split).filter(l => {
    const [key = '', value = ''] = l.split(/:\t/)
    return VIEW_FIELDS.includes(key) && value.trim() !== ''
  }).map(l => l.replace(/:\t/, ': '))
  const body = markdownBody(lines.slice(split + 1))
  const cut = body.length > MAX_BODY_LINES
  const shown = cut ? [...body.slice(0, MAX_BODY_LINES), `… +${body.length - MAX_BODY_LINES} body lines`] : body
  return { text: [...head, '', ...shown].join('\n').trim(), elided: cut }
}

// -------------------------------------------------------------------------------------------- lists

type Row = string[]

const rowsOf = (text: string): Row[] => linesOf(text).filter(l => l.trim() !== '').map(l => l.split('\t'))

function list(format: (r: Row) => string) {
  return (input: { args: string[]; text: string }): FilterResult => {
    if (hasArg(input.args, ...OWN_FORMAT)) return cleanup(input.text)
    const rows = rowsOf(input.text)
    if (rows.some(r => r.length < 3)) return cleanup(input.text)
    const c = capped(rows.map(r => cutLine(format(r), 140)), CAP_LIST)
    return { text: c.lines.join('\n'), elided: c.elided }
  }
}

/** `123\tTitle\tbranch\tOPEN\tdate` */
const prRow = (r: Row): string => `#${r[0]} ${r[1]} [${r[2]}] ${r[3] ?? ''}`.trim()

/** `123\tOPEN\tTitle\tlabels\tdate` */
const issueRow = (r: Row): string => `#${r[0]} ${r[2]} (${r[1]})${r[3] ? ` [${r[3]}]` : ''}`

/** `status\tconclusion\ttitle\tworkflow\tbranch\tevent\tid\telapsed\tdate` */
function runRow(r: Row): string {
  const mark = r[0] !== 'completed' ? '…' : r[1] === 'success' ? '✓' : r[1] === 'skipped' ? '-' : '✗'
  return `${mark} ${r[2]} (${r[3]}, ${r[4]}) ${r[6] ?? ''} ${r[7] ?? ''}`.trim()
}

/** `name\tstate\telapsed\turl`: the failures by name, and a count of the rest. */
function checks(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, ...OWN_FORMAT)) return cleanup(input.text)
  const rows = rowsOf(input.text).filter(r => r.length >= 2)
  if (rows.length === 0) return cleanup(input.text)
  const failing = rows.filter(r => /fail|cancel|timed_out/i.test(r[1] ?? ''))
  const pending = rows.filter(r => /pending|queued|in_progress/i.test(r[1] ?? ''))
  const passed = rows.length - failing.length - pending.length
  const head = `${passed} passed, ${failing.length} failing, ${pending.length} pending`
  return { text: [head, ...failing.map(r => `  ✗ ${r[0]} ${r[3] ?? ''}`.trimEnd()), ...pending.map(r => `  … ${r[0]}`)].join('\n'), elided: false }
}

/** The table's key for `gh pr list` is `gh pr`, so one entry reads the subcommand's own first word. */
function byAction(actions: Record<string, (input: { args: string[]; text: string }) => FilterResult>) {
  return (input: { args: string[]; text: string; exitCode: number }): FilterResult => {
    const action = input.args.find(a => !a.startsWith('-')) ?? ''
    const run = actions[action]
    return run === undefined ? cleanup(input.text) : run({ args: input.args.filter(a => a !== action), text: input.text })
  }
}

export const GH: FilterTable = {
  'gh pr': { run: byAction({ list: list(prRow), view, checks, status: ({ text }) => cleanup(text) }) },
  'gh issue': { run: byAction({ list: list(issueRow), view }) },
  'gh run': { run: byAction({ list: list(runRow), view: ({ text }) => cleanup(text) }) },
  'gh release': { run: byAction({ view }) },
  'glab mr': { run: byAction({ view }) },
  'glab issue': { run: byAction({ view }) },
}
