/**
 * A unified diff with its bulk cut: file headers become the path with a `+added -removed` count, context
 * lines go except the three right before a change, and a hunk shows at most 100 changed lines, a diff
 * 500. The result reads as the change, not as a patch; `BASH_DIET_RAW=1` gives the patch.
 */

const MAX_HUNK_LINES = 100
const MAX_DIFF_LINES = 500
const LEADING_CONTEXT = 3

type Diff = {
  out: string[]
  file: string
  added: number
  removed: number
  inHunk: boolean
  hunkShown: number
  total: number
  skippedAdd: number
  skippedDel: number
  context: string[]
  elided: boolean
}

/** The path a `diff --git a/x b/y` header names: the new side, without its `b/`. */
function pathOf(header: string): string {
  const m = /^diff --(?:git|cc|combined) (?:"?a\/)?(.*?)"? "?b\/(.*?)"?$/.exec(header)
  if (m !== null) return m[2] === m[1] ? (m[2] ?? '') : `${m[1]} → ${m[2]}`
  return header.replace(/^diff --\S+ /, '')
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Writes the note for changed lines a hunk left out, and the file's count when the file ends. */
function closeHunk(d: Diff): void {
  const parts = [d.skippedDel > 0 ? plural(d.skippedDel, 'deletion') : '', d.skippedAdd > 0 ? plural(d.skippedAdd, 'addition') : ''].filter(p => p !== '')
  if (parts.length > 0) {
    d.out.push(`  ... (${parts.join(', ')} left out)`)
    d.elided = true
  }
  d.skippedAdd = 0
  d.skippedDel = 0
  d.context = []
}

function closeFile(d: Diff): void {
  closeHunk(d)
  if (d.file !== '' && (d.added > 0 || d.removed > 0)) d.out.push(`  +${d.added} -${d.removed}`)
}

function openFile(d: Diff, header: string): void {
  closeFile(d)
  d.file = pathOf(header)
  d.out.push('', d.file)
  d.added = 0
  d.removed = 0
  d.inHunk = false
}

/** A line between a file header and its first hunk: only a new, deleted or renamed file says something. */
function fileMeta(d: Diff, line: string): void {
  if (/^(new|deleted) file mode/.test(line)) d.out.push(`  (${line.split(' ')[0]} file)`)
  else if (line.startsWith('Binary files')) d.out.push('  (binary)')
}

function change(d: Diff, line: string): void {
  const isAdd = line.startsWith('+')
  if (isAdd) d.added += 1
  else d.removed += 1
  if (d.hunkShown >= MAX_HUNK_LINES || d.total >= MAX_DIFF_LINES) {
    if (isAdd) d.skippedAdd += 1
    else d.skippedDel += 1
    return
  }
  d.out.push(...d.context, line)
  d.total += d.context.length + 1
  d.hunkShown += 1
  d.context = []
}

/** A context line waits in a ring of three; it shows only when a change follows it. */
function context(d: Diff, line: string): void {
  d.context.push(line)
  if (d.context.length > LEADING_CONTEXT) d.context.shift()
}

function hunkLine(d: Diff, line: string): void {
  if (line.startsWith('\\')) return
  if (line.startsWith('+') || line.startsWith('-')) return change(d, line)
  context(d, line)
}

function step(d: Diff, line: string): void {
  if (line.startsWith('diff --')) return openFile(d, line)
  if (line.startsWith('@@')) {
    closeHunk(d)
    d.out.push(line)
    d.inHunk = true
    d.hunkShown = 0
    return
  }
  if (d.inHunk) return hunkLine(d, line)
  fileMeta(d, line)
}

/** The diff part of an output condensed; `elided` when a hunk or the diff hit its cap. */
export function compactDiff(lines: string[]): { lines: string[]; elided: boolean } {
  const d: Diff = { out: [], file: '', added: 0, removed: 0, inHunk: false, hunkShown: 0, total: 0, skippedAdd: 0, skippedDel: 0, context: [], elided: false }
  for (const line of lines) step(d, line)
  closeFile(d)
  while (d.out[0] === '') d.out.shift()
  return { lines: d.out, elided: d.elided }
}

/** Splits an output at its first `diff --` header: what comes before (a commit header) and the diff. */
export function splitAtDiff(lines: string[]): { head: string[]; diff: string[] } {
  const at = lines.findIndex(l => l.startsWith('diff --'))
  return at < 0 ? { head: lines, diff: [] } : { head: lines.slice(0, at), diff: lines.slice(at) }
}
