import { plural } from './blocks.ts'
import { CAP_ERRORS, CAP_INVENTORY, CAP_WARNINGS, capped, collapseBlanks, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

// ----------------------------------------------------------------------------------------------- php -l

/** `php -l`: the syntax errors once each, and a count of the files that passed. */
function lint(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  const passed = lines.filter(l => l.startsWith('No syntax errors detected in ')).length
  const errors = [...new Set(lines.filter(l => /(Parse|Fatal) error:/.test(l)).map(l => l.replace(/^PHP /, '').replace(/\s+/g, ' ').trim()))]
  return whole([...errors, `php -l: ${plural(passed, 'file')} without syntax errors${errors.length > 0 ? `, ${plural(errors.length, 'error')}` : ''}`])
}

const php = (input: { args: string[]; text: string }): FilterResult => (hasArg(input.args, '-l', '--syntax-check') ? lint(input) : cleanup(input.text))

// ------------------------------------------------------------------------------------------ test runners

/**
 * PHPUnit, Pest, ParaTest and `artisan test` lines that report nothing: the header, the runtime, the
 * progress rows, passing tests and the timing.
 */
const RUNNER_NOISE = /^(PHPUnit \d|ParaTest v?\d|Runtime:|Configuration:|Random Seed:|Processes:|Time: [\d:.]+, Memory:|Duration:|[.FEWRSIND]+\s+\d+ \/ \d+ \(\s*\d+%\)$|PASS\s|✓|✔|- )/

/** A numbered failure (`1) App\UserTest::testEmail`) or a Pest failure heading. */
const FAILURE_HEAD = /^(\d+\) \S+|FAILED\s|⨯|✗|×)/

/** Only the project's frames: the vendor directory holds the framework. */
const isVendorFrame = (line: string): boolean => /\/vendor\//.test(line) && /^\s*(#\d+ |at )|\.php:\d+\s*$/.test(line)

/** The failures up to the cap and a count of the rest, cut at the summary. */
function failuresOf(lines: string[]): { lines: string[]; over: number } {
  const starts = lines.map((l, i) => (FAILURE_HEAD.test(l.trim()) ? i : -1)).filter(i => i >= 0)
  if (starts.length <= CAP_WARNINGS) return { lines, over: 0 }
  const cut = starts[CAP_WARNINGS] ?? lines.length
  const summary = lines.slice(cut).findIndex(l => /^(FAILURES!|ERRORS!|OK |Tests:)/.test(l.trim()))
  return { lines: [...lines.slice(0, cut), ...(summary < 0 ? [] : lines.slice(cut + summary))], over: starts.length - CAP_WARNINGS }
}

/** A PHP test run: failures with their messages and project frames, and the result lines. */
function phpTests(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  if (!lines.some(l => /^\s*(OK \(|OK, but|FAILURES!|ERRORS!|Tests:\s)/.test(l))) return cleanup(input.text)
  const kept = collapseBlanks(lines.filter(l => !RUNNER_NOISE.test(l.trim()) && !isVendorFrame(l))).filter((l, i) => i > 0 || l.trim() !== '')
  const c = failuresOf(kept)
  return { text: [...c.lines, ...(c.over > 0 ? [`… +${c.over} more failures`] : [])].join('\n'), elided: c.over > 0 }
}

// ---------------------------------------------------------------------------------------------- phpstan

type PhpstanReport = {
  totals?: { errors?: number; file_errors?: number }
  files?: Record<string, { messages?: { message?: string; line?: number; identifier?: string }[] }>
  errors?: string[]
}

/** The directory every path shares, so each file reads relative to it. */
function sharedDir(paths: string[]): string {
  if (paths.length < 2) return paths[0]?.replace(/[^/]*$/, '') ?? ''
  const parts = paths.map(p => p.split('/'))
  const first = parts[0] ?? []
  let n = 0
  while (n < first.length - 1 && parts.every(p => p[n] === first[n])) n += 1
  return n === 0 ? '' : `${first.slice(0, n).join('/')}/`
}

/** One file's errors: `  15 message [identifier]`, capped. */
function fileErrors(name: string, messages: { message?: string; line?: number; identifier?: string }[]): string[] {
  const rows = messages.map(m => `  ${m.line ?? '?'} ${m.message ?? ''}${m.identifier === undefined ? '' : ` [${m.identifier}]`}`)
  return [`${name} (${messages.length}):`, ...capped(rows, CAP_WARNINGS, 'more in this file').lines]
}

/** The report from the first `{` on, or undefined when that is not JSON. */
function reportOf(text: string): PhpstanReport | undefined {
  try {
    return JSON.parse(text.slice(Math.max(0, text.indexOf('{')))) as PhpstanReport
  } catch {
    return undefined
  }
}

/** One error of the table report: its line, its message over the rows it wraps to, and its identifier. */
type TableError = { line: string; message: string[]; identifier?: string }

/** What the table report holds: errors by file in order, lines no rule reads, and the final verdict. */
type Table = { files: Map<string, TableError[]>; file: string; tip: boolean; other: string[]; verdict?: string }

/** `  :6     Call to an undefined method Cart::missing().`: phpstan 2 puts a colon before the line. */
const TABLE_ROW = /^\s{2}:?(\d+)\s{2,}(\S.*?)\s*$/

/** A table row that goes on under the message column. */
const TABLE_MORE = /^\s{9}(\S.*?)\s*$/

/** A continuation row: the identifier, a tip and the tip's own rows, or more of the message. */
function tableMore(t: Table, text: string): void {
  const last = t.files.get(t.file)?.at(-1)
  if (text.startsWith('🪪')) { if (last !== undefined) last.identifier = text.replace(/^🪪\s*/, ''); t.tip = false; return }
  if (text.startsWith('💡')) { t.tip = true; return }
  if (!t.tip && last !== undefined) last.message.push(text)
}

/** A table rule, a blank line or a progress bar: nothing to read. */
const isFrame = (line: string): boolean => /^\s*-[-\s]*$/.test(line) || line.trim() === '' || /^\s*\d+\/\d+ \[/.test(line)

/** `  Line   Cart.php`: the table of one file starts. */
function tableHeader(t: Table, line: string): boolean {
  const header = /^\s{2}Line\s{2,}(\S.*?)\s*$/.exec(line)
  if (header === null) return false
  t.file = header[1] ?? ''
  t.files.set(t.file, t.files.get(t.file) ?? [])
  return true
}

/** One error's first row. */
function tableRow(t: Table, line: string): boolean {
  const row = TABLE_ROW.exec(line)
  if (row === null) return false
  t.files.get(t.file)?.push({ line: row[1] ?? '', message: [row[2] ?? ''] })
  t.tip = false
  return true
}

/** A row under the message column of the current file's table. */
function tableContinues(t: Table, line: string): boolean {
  const more = TABLE_MORE.exec(line)
  if (more === null || !t.files.has(t.file)) return false
  tableMore(t, more[1] ?? '')
  return true
}

/** `[ERROR] Found 3 errors` or `[OK] No errors`. */
function tableVerdict(t: Table, line: string): boolean {
  if (!/^\s*\[(ERROR|OK)\] /.test(line)) return false
  t.verdict = line.trim()
  return true
}

function tableLine(t: Table, line: string): void {
  if (isFrame(line) || tableHeader(t, line) || tableRow(t, line) || tableContinues(t, line) || tableVerdict(t, line)) return
  t.other.push(line.trimEnd())
}

/**
 * phpstan's default table report grouped by file, one line per error with its identifier. The progress
 * bars and the table rules go; every line no rule reads, such as the notes phpstan writes before the
 * table, stays as it was.
 */
function phpstanTable(text: string): FilterResult {
  const t: Table = { files: new Map(), file: '', tip: false, other: [] }
  for (const line of linesOf(text)) tableLine(t, line)
  if (t.verdict === undefined) return cleanup(text)
  const rows = [...t.files].flatMap(([file, errors]) => fileErrors(file, errors.map(e => ({ line: Number(e.line), message: e.message.join(' '), identifier: e.identifier }))))
  const c = capped(rows, CAP_INVENTORY, 'lines')
  const total = [...t.files.values()].reduce((n, e) => n + e.length, 0)
  const head = total === 0 ? 'phpstan: no errors' : `phpstan: ${plural(total, 'error')} in ${plural(t.files.size, 'file')}`
  const cut = [...t.files.values()].some(e => e.length > CAP_WARNINGS)
  return { text: [...t.other, ...c.lines, head].join('\n'), elided: c.elided || cut }
}

/** A phpstan run: its JSON report when the arguments asked for one, else its table report. */
function phpstan(input: { text: string }): FilterResult {
  const report = input.text.includes('"totals"') ? reportOf(input.text) : undefined
  return report === undefined ? phpstanTable(input.text) : phpstanJson(report)
}

/** A phpstan JSON report, grouped by file with the line of each error. */
function phpstanJson(report: PhpstanReport): FilterResult {
  const files = Object.entries(report.files ?? {})
  const base = sharedDir(files.map(([path]) => path))
  const rows = files.flatMap(([path, f]) => fileErrors(path.slice(base.length), f.messages ?? []))
  const c = capped(rows, CAP_INVENTORY, 'lines')
  const general = report.errors ?? []
  const head = headOf((report.totals?.file_errors ?? 0) + general.length, files.length, base)
  return { text: [...general.slice(0, CAP_ERRORS), ...c.lines, head].join('\n'), elided: c.elided || files.some(([, f]) => (f.messages?.length ?? 0) > CAP_WARNINGS) }
}

/** `phpstan: 3 errors in 2 files under /var/www/app/`, or that there are none. */
function headOf(total: number, files: number, base: string): string {
  if (total === 0) return 'phpstan: no errors'
  return `phpstan: ${plural(total, 'error')} in ${plural(files, 'file')}${base === '' ? '' : ` under ${base}`}`
}

export const PHP: FilterTable = {
  php: { run: php },
  phpunit: { run: phpTests },
  pest: { run: phpTests },
  paratest: { run: phpTests },
  'artisan test': { run: phpTests },
  'phpstan analyse': { run: phpstan },
  'phpstan analyze': { run: phpstan },
}
