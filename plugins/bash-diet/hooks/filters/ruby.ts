import { byRule, plural, type Issue } from './blocks.ts'
import { CAP_WARNINGS, collapseBlanks, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
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

/** The failed-test blocks up to the cap, and a count of the rest. */
function cappedBlocks(lines: string[]): { lines: string[]; over: number } {
  const starts = lines.map((l, i) => (MINITEST_BLOCK.test(l) ? i : -1)).filter(i => i >= 0)
  if (starts.length <= CAP_WARNINGS) return { lines, over: 0 }
  const cut = starts[CAP_WARNINGS] ?? lines.length
  const rest = lines.slice(cut).findIndex(l => /^\d+ (runs|tests), /.test(l))
  return { lines: [...lines.slice(0, cut), ...(rest < 0 ? [] : lines.slice(cut + rest))], over: starts.length - CAP_WARNINGS }
}

/** `rake test`, `rails test`: the failed tests with their project frames, and the count line. */
function minitest(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  if (!lines.some(l => /^\d+ (runs|tests), \d+ assertions/.test(l))) return cleanup(input.text)
  const kept = collapseBlanks(lines.filter(l => !MINITEST_NOISE.test(l.trim()) && !GEM_FRAME.test(l))).filter((l, i) => i > 0 || l.trim() !== '')
  const c = cappedBlocks(kept)
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

/** An rspec JSON report: the failed examples, what failed outside them, and the summary line. */
function rspec(input: { text: string }): FilterResult {
  const report = jsonAfter<RspecReport>(input.text, '{"version"')
  if (report === undefined) return cleanup(input.text)
  const failed = (report.examples ?? []).filter(e => e.status === 'failed')
  const shown = failed.slice(0, CAP_WARNINGS).flatMap((e, i) => failedExample(e, i + 1))
  const over = failed.length - CAP_WARNINGS
  const outside = (report.messages ?? []).filter(m => m.trim() !== '')
  return {
    text: [...outside, ...shown, ...(over > 0 ? [`… +${over} more failed examples`] : []), `rspec: ${report.summary_line ?? ''}`].join('\n'),
    elided: over > 0,
  }
}

/** Options that choose rspec's output themselves. */
const RSPEC_OWN = ['--format', '-f', '--out', '-o', '--dry-run', '--init', '--help', '-h', '--version', '-v']

// -------------------------------------------------------------------------------------------- rubocop

type RubocopReport = {
  files?: { path?: string; offenses?: { cop_name?: string; message?: string }[] }[]
  summary?: { offense_count?: number; inspected_file_count?: number }
}

/** A rubocop JSON report, grouped by cop. */
function rubocop(input: { text: string }): FilterResult {
  const report = jsonAfter<RubocopReport>(input.text, '{"metadata"')
  if (report === undefined) return cleanup(input.text)
  const issues: Issue[] = (report.files ?? []).flatMap(f => (f.offenses ?? []).map(o => ({ file: f.path ?? '', code: o.cop_name ?? '', text: o.message ?? '' })))
  if (issues.length === 0) return whole([`rubocop: no offenses in ${plural(report.summary?.inspected_file_count ?? 0, 'file')}`])
  return byRule(issues, 'rubocop')
}

const RUBOCOP_OWN = ['--format', '-f', '--out', '-o', '--version', '-V', '--help', '-h', '--show-cops', '--list-target-files', '-L', '--auto-gen-config']

// ------------------------------------------------------------------------------------------- bundler

/** `bundle install` and `update`: the gems already there and the resolver's steps go. */
const bundle = (input: { text: string }): FilterResult =>
  whole(linesOf(input.text).filter(l => !/^(Using |Fetching gem metadata|Fetching source index|Resolving dependencies|Fetching \S+ [\d.]+$)/.test(l.trim()) && l.trim() !== ''))

export const RUBY: FilterTable = {
  'rake test': { run: minitest },
  'rails test': { run: minitest },
  ruby: { run: minitest },
  rspec: { run: rspec, flags: args => (hasArg(args, ...RSPEC_OWN) ? undefined : ['--format', 'json']) },
  rubocop: { run: rubocop, flags: args => (hasArg(args, ...RUBOCOP_OWN) ? undefined : ['--format', 'json']) },
  'bundle install': { run: bundle },
  'bundle update': { run: bundle },
}
