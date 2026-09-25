/**
 * make runs whatever its recipes name, so the filter cannot tell which tool wrote a line. It drops only
 * lines of an explicit shape: make's own lines about directories, compiler source excerpts, and the line
 * each test runner writes for a passing test. Every failure, summary and line of another shape stays.
 */

import { collapseBlanks, linesOf, type FilterResult, type FilterTable } from './common.ts'

/** make's own lines about the directories it enters and the targets with nothing to do. */
const MAKE_NOISE = /^g?make(\[\d+\])?: ((Entering|Leaving) directory|Nothing to be done for)/

/** A clang or gcc source excerpt under a diagnostic: `   12 | code` and the `  |   ^` marker line. */
const EXCERPT = /^\s*\d+ \| |^\s+\| /

/** The line go test -v writes when a test starts, pauses, resumes or writes again; `--- FAIL` names a failure. */
const GO_EVENT = /^=== (RUN|PAUSE|CONT|NAME)\s/

/**
 * One passing test as each runner writes it into a pipe: Claude Code's plugin test runner
 * (`(pass) name`), go test -v (`--- PASS: name`), cargo test (`test name ... ok`), pytest -v
 * (`path::name PASSED`) and vitest's verbose reporter (`✓ file > name`). bun test and jest write no line
 * for a passing test into a pipe, and a bare `✓` is also vite's build progress, so neither is here.
 */
const PASSING = [/^\(pass\) /, /^\s*--- PASS: /, /^test \S+ \.\.\. ok$/, /^\S+::\S+ PASSED\b/, /^\s*✓ \S.* > /]

/** The header the plugin test runner writes above each test file's lines: `tests/core.test.ts:`. */
const TEST_FILE = /^\S+\.(test|spec)\.[cm]?[jt]sx?:$/

const isNoise = (line: string): boolean => MAKE_NOISE.test(line) || EXCERPT.test(line) || GO_EVENT.test(line)
const isPassing = (line: string): boolean => PASSING.some(p => p.test(line))

/** A kept line, or undefined where a passing test was left out. */
type Row = string | undefined

/** Whether the rows from `from` to the next blank line or test file header are passing tests alone. */
function onlyPassing(rows: Row[], from: number): boolean {
  const next = rows.slice(from).find(r => r !== undefined)
  return next === undefined || next.trim() === '' || TEST_FILE.test(next)
}

/** The output with the noise gone, a test file header over passing tests alone gone, and the passing tests counted where the first of them stood. */
export function makeOutput(text: string): FilterResult {
  const read: Row[] = linesOf(text).filter(l => !isNoise(l)).map(l => (isPassing(l) ? undefined : l))
  const rows = read.filter((r, i) => r === undefined || !TEST_FILE.test(r) || !onlyPassing(read, i + 1))
  const passing = rows.filter(r => r === undefined).length
  const first = rows.indexOf(undefined)
  const count = `… ${passing} passing test${passing === 1 ? '' : 's'} left out`
  const lines = rows.flatMap((r, i) => (r !== undefined ? [r] : i === first ? [count] : []))
  return { text: collapseBlanks(lines).join('\n'), elided: passing > 0 }
}

export const MAKE: FilterTable = {
  make: { run: ({ text }) => makeOutput(text) },
  gmake: { run: ({ text }) => makeOutput(text) },
}
