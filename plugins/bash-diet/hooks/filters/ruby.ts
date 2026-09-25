import { byRule, plural, type Issue } from './blocks.ts'
import { CAP_WARNINGS, collapseBlanks, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** A backtrace line inside an installed gem: it names none of the project's code. */
const GEM_FRAME = /\/(gems|rubygems)\/|\/lib\/ruby\/\d/

/** The JSON a reporter printed, from its first `{` on: a test may print lines before it. */
function jsonAfter<T>(text: string, start: string): T | undefined {
  const at = text.indexOf(start)
  if (at < 0) return undefined
  try {
    return JSON.parse(text.slice(at)) as T
  } catch {
    return undefined
  }
}

// ------------------------------------------------------------------------------------------- minitest

/** Minitest's and rake's lines that report nothing. */
const MINITEST_NOISE = /^(Run options:|# Running:|Finished in [\d.]+s|You have skipped tests|Tasks: TOP|\(See full trace|[.FESN]+$)/

/** `  1) Failure:` or `  2) Error:`, the start of one failed test. */
const MINITEST_BLOCK = /^\s+\d+\) (Failure|Error):/

/** The failed-test blocks up to the cap, then the report from its summary line on, and a count of the rest. */
function cappedBlocks(lines: string[], block: RegExp, summary: RegExp): { lines: string[]; over: number } {
  const starts = lines.map((l, i) => (block.test(l) ? i : -1)).filter(i => i >= 0)
  if (starts.length <= CAP_WARNINGS) return { lines, over: 0 }
  const cut = starts[CAP_WARNINGS] ?? lines.length
  const rest = lines.slice(cut).findIndex(l => summary.test(l))
  return { lines: [...lines.slice(0, cut), ...(rest < 0 ? [] : lines.slice(cut + rest))], over: starts.length - CAP_WARNINGS }
}

/** The report's lines without the noise and the gem frames, blank runs folded, a leading blank gone. */
const reportLines = (lines: string[], noise: RegExp): string[] =>
  collapseBlanks(lines.filter(l => !noise.test(l.trim()) && !GEM_FRAME.test(l))).filter((l, i) => i > 0 || l.trim() !== '')

/** `rake test`, `rails test`: the failed tests with their project frames, and the count line. */
function minitest(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  if (!lines.some(l => /^\d+ (runs|tests), \d+ assertions/.test(l))) return cleanup(input.text)
  const c = cappedBlocks(reportLines(lines, MINITEST_NOISE), MINITEST_BLOCK, /^\d+ (runs|tests), /)
  return { text: [...c.lines, ...(c.over > 0 ? [`… +${c.over} more failed tests`] : [])].join('\n'), elided: c.over > 0 }
}

// ---------------------------------------------------------------------------------------------- rspec

type RspecExample = {
  full_description?: string
  status?: string
  file_path?: string
  line_number?: number
  exception?: { class?: string; message?: string; backtrace?: string[] } | null
}

type RspecReport = { examples?: RspecExample[]; summary_line?: string; messages?: string[] }

/** An exception as `Class: message` over up to six lines, and the first frame in the project. */
function exceptionLines(exception: NonNullable<RspecExample['exception']>): string[] {
  const [first = '', ...rest] = (exception.message ?? '').trim().split('\n').slice(0, 6)
  const frame = (exception.backtrace ?? []).find(b => !GEM_FRAME.test(b))
  return [`${exception.class ?? 'Error'}: ${first}`, ...rest, ...(frame === undefined ? [] : [frame])].map(l => `   ${l}`)
}

/** One failed example: its name and place, then its exception. */
function failedExample(e: RspecExample, n: number): string[] {
  const head = `${n}) ${e.full_description ?? ''} (${e.file_path ?? ''}:${e.line_number ?? ''})`
  return [head, ...(e.exception == null ? [] : exceptionLines(e.exception))]
}

/** rspec's progress dots and timing. */
const RSPEC_NOISE = /^([.F*]+|Finished in .*|Randomized with seed \d+)$/

/** `22 examples, 2 failures`, the summary line of the text report. */
const RSPEC_SUMMARY = /^\d+ examples?, \d+ failures?/

/** rspec's text report: the failures with their project frames, the summary, and the rerun lines. */
function rspecText(lines: string[]): FilterResult {
  const c = cappedBlocks(reportLines(lines, RSPEC_NOISE), /^\s+\d+\) /, RSPEC_SUMMARY)
  return { text: [...c.lines, ...(c.over > 0 ? [`… +${c.over} more failed examples`] : [])].join('\n'), elided: c.over > 0 }
}

/** An rspec run: its JSON report when the arguments asked for one, else its text report. */
function rspec(input: { text: string }): FilterResult {
  const report = jsonAfter<RspecReport>(input.text, '{"version"')
  if (report !== undefined) return rspecJson(report)
  const lines = linesOf(input.text)
  return lines.some(l => RSPEC_SUMMARY.test(l)) ? rspecText(lines) : cleanup(input.text)
}

/** An rspec JSON report: the failed examples, what failed outside them, and the summary line. */
function rspecJson(report: RspecReport): FilterResult {
  const failed = (report.examples ?? []).filter(e => e.status === 'failed')
  const shown = failed.slice(0, CAP_WARNINGS).flatMap((e, i) => failedExample(e, i + 1))
  const over = failed.length - CAP_WARNINGS
  const outside = (report.messages ?? []).filter(m => m.trim() !== '')
  return {
    text: [...outside, ...shown, ...(over > 0 ? [`… +${over} more failed examples`] : []), `rspec: ${report.summary_line ?? ''}`].join('\n'),
    elided: over > 0,
  }
}

// -------------------------------------------------------------------------------------------- rubocop

type RubocopReport = {
  files?: { path?: string; offenses?: { cop_name?: string; message?: string }[] }[]
  summary?: { offense_count?: number; inspected_file_count?: number }
}

/** A rubocop JSON report, grouped by cop. */
function rubocopJson(report: RubocopReport): FilterResult {
  const issues: Issue[] = (report.files ?? []).flatMap(f => (f.offenses ?? []).map(o => ({ file: f.path ?? '', code: o.cop_name ?? '', text: o.message ?? '' })))
  if (issues.length === 0) return whole([`rubocop: no offenses in ${plural(report.summary?.inspected_file_count ?? 0, 'file')}`])
  return byRule(issues, 'rubocop')
}

/** `lib/cart.rb:1:1: C: [Correctable] Style/Documentation: message`, one offense of the text report. */
const RUBOCOP_LINE = /^(.+?):\d+:\d+: [CWEFR]: (?:\[Correctable\] )?([\w/]+): (.*)$/

/** rubocop's text report grouped by cop: the new-cops notice, the source lines and the carets go. */
function rubocopText(text: string): FilterResult {
  const lines = linesOf(text)
  const issues = lines.map(l => RUBOCOP_LINE.exec(l)).filter(m => m !== null).map(m => ({ file: m[1] ?? '', code: m[2] ?? '', text: m[3] ?? '' }))
  if (issues.length > 0) return byRule(issues, 'rubocop')
  const clean = lines.find(l => /^\d+ files? inspected, no offenses detected/.test(l))
  return clean === undefined ? cleanup(text) : whole([`rubocop: ${clean}`])
}

/** A rubocop run: its JSON report when the arguments asked for one, else its text report. */
function rubocop(input: { text: string }): FilterResult {
  const report = jsonAfter<RubocopReport>(input.text, '{"metadata"')
  return report === undefined ? rubocopText(input.text) : rubocopJson(report)
}

// ------------------------------------------------------------------------------------------- bundler

/** `bundle install` and `update`: the gems already there and the resolver's steps go. */
const bundle = (input: { text: string }): FilterResult =>
  whole(linesOf(input.text).filter(l => !/^(Using |Fetching gem metadata|Fetching source index|Resolving dependencies|Fetching \S+ [\d.]+$)/.test(l.trim()) && l.trim() !== ''))

export const RUBY: FilterTable = {
  'rake test': { run: minitest },
  'rails test': { run: minitest },
  ruby: { run: minitest },
  rspec: { run: rspec },
  rubocop: { run: rubocop },
  'bundle install': { run: bundle },
  'bundle update': { run: bundle },
}
