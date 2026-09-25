import { blocksOf, plural, shownBlocks } from './blocks.ts'
import { CAP_ERRORS, CAP_WARNINGS, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/**
 * Cargo's own progress lines: which crates it fetched, locked and compiled. Cargo right-aligns the verb
 * in a 12-column field, so each starts with a space; a program's own `Running ...` line does not.
 */
const PROGRESS = /^\s+(Compiling|Checking|Downloading|Downloaded|Updating|Locking|Adding|Blocking|Fresh|Documenting|Packaging|Verifying|Archiving|Unpacking|Installing|Replacing|Scraping|Building|Running|Doc-tests)\b/

/** The closing lines rustc and cargo add after the diagnostics; the summary replaces them. */
const TRAILER = /^(warning: .* generated \d+ warnings?|error: could not compile|error: aborting due to|warning: build failed|error: test failed, to rerun)/

const startOf = (line: string): 'error' | 'warning' | undefined =>
  /^error(\[E\d+\])?:/.test(line) ? 'error' : /^warning(\[\w+\])?:/.test(line) ? 'warning' : undefined

/** `Finished `dev` profile [...] target(s) in 3.21s` as `3.21s`. */
const elapsedOf = (lines: string[]): string | undefined =>
  lines.map(l => /Finished .* in ([\d.]+m?s)/.exec(l)?.[1]).find(t => t !== undefined)

/** A build, check or clippy run: the diagnostics capped, then one line that counts them. */
export function build(verb: string) {
  return (input: { text: string; exitCode: number }): FilterResult => {
    const lines = linesOf(input.text)
    const compiled = lines.filter(l => /^\s*(Compiling|Checking) /.test(l)).length
    const elapsed = elapsedOf(lines)
    const b = blocksOf(lines.filter(l => !PROGRESS.test(l) && !/^\s+Finished /.test(l) && !TRAILER.test(l)), startOf)
    const errors = shownBlocks(b.errors, CAP_ERRORS, 'errors')
    const warnings = shownBlocks(b.warnings, CAP_WARNINGS, 'warnings')
    const time = elapsed === undefined ? '' : `, ${elapsed}`
    const summary = b.errors.length + b.warnings.length === 0 && input.exitCode === 0
      ? `cargo ${verb}: ok (${plural(compiled, 'crate')} compiled${time})`
      : `cargo ${verb}: ${plural(b.errors.length, 'error')}, ${plural(b.warnings.length, 'warning')}${time}`
    const body = [...errors.lines, ...(errors.lines.length > 0 && warnings.lines.length > 0 ? [''] : []), ...warnings.lines]
    return { text: [...body, ...(body.length > 0 ? [''] : []), ...b.other, summary].join('\n'), elided: errors.elided || warnings.elided }
  }
}

type Tally = { passed: number; failed: number; ignored: number; suites: number }

/** Adds one `test result: ok. 12 passed; 0 failed; 1 ignored; ...` line to the tally. */
function tally(t: Tally, line: string): boolean {
  const m = /^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/.exec(line)
  if (m === null) return false
  t.passed += Number(m[1])
  t.failed += Number(m[2])
  t.ignored += Number(m[3])
  t.suites += 1
  return true
}

type TestRun = { tally: Tally; failures: string[]; inFailures: boolean; inNames: boolean; other: string[] }

/** Progress, a `running N tests` header, or one test's verdict line: the tally and the failure blocks say it. */
const isTestNoise = (line: string): boolean =>
  PROGRESS.test(line) || /^\s+Finished /.test(line) || /^running \d+ tests?$/.test(line) || /^test .* \.\.\. (ok|ignored|FAILED)$/.test(line)

/** A `cargo test` line: a result line counts, a failure block stays, a passing test and progress go. */
function testLine(r: TestRun, line: string): void {
  if (tally(r.tally, line)) { r.inFailures = false; r.inNames = false; return }
  if (line === 'failures:') { r.inNames = r.inFailures; r.inFailures = true; return }
  if (r.inNames || isTestNoise(line)) return
  if (r.inFailures) r.failures.push(line)
  else if (line.trim() !== '' && !TRAILER.test(line)) r.other.push(line)
}

function test(input: { text: string; exitCode: number }): FilterResult {
  const lines = linesOf(input.text)
  const r: TestRun = { tally: { passed: 0, failed: 0, ignored: 0, suites: 0 }, failures: [], inFailures: false, inNames: false, other: [] }
  for (const line of lines) testLine(r, line)
  if (r.tally.suites === 0) return lines.some(l => startOf(l) === 'error') ? build('test')(input) : cleanup(input.text)
  const t = r.tally
  const head = `cargo test: ${t.passed} passed, ${t.failed} failed${t.ignored > 0 ? `, ${t.ignored} ignored` : ''} (${plural(t.suites, 'suite')})`
  const failures = r.failures.join('\n').trim()
  return whole([...r.other, ...(failures === '' ? [] : [failures, '']), head])
}

/** nextest: every `PASS` line goes; failures, their output and the summary stay. */
function nextest(input: { text: string }): FilterResult {
  return whole(linesOf(input.text).filter(l => !/^\s*(PASS|SKIP|START|SLOW)\s+\[/.test(l) && !PROGRESS.test(l) && !/^\s+Finished /.test(l)))
}

/** An install: the fetch and compile lines go; what was installed and every diagnostic stay. */
function install(input: { text: string }): FilterResult {
  const kept = linesOf(input.text).filter(l => !PROGRESS.test(l) || /^\s*(Installing|Replacing|Installed|Replaced) .*(\/|\bv\d)/.test(l))
  return whole(kept.filter(l => !/^\s+Finished /.test(l)))
}

export const RUST: FilterTable = {
  'cargo build': { run: build('build') },
  'cargo check': { run: build('check') },
  'cargo clippy': { run: build('clippy') },
  'cargo doc': { run: build('doc') },
  'cargo run': { run: ({ text }) => whole(linesOf(text).filter(l => !PROGRESS.test(l) && !/^\s+Finished /.test(l))) },
  'cargo test': { run: input => (hasArg(input.args, '--format', '-Z') ? cleanup(input.text) : test(input)) },
  'cargo nextest': { run: nextest },
  'cargo install': { run: install },
}
