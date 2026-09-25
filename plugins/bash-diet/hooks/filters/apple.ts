import { CAP_INVENTORY, capped, linesOf, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** A Swift or clang diagnostic: `path:12:5: error: message`, the column absent in XCTest's lines. */
const DIAGNOSTIC = /^\S.*:\d+(:\d+)?: (error|warning): /

/** A note under a diagnostic's source excerpt: `  |     |- note: convert it to a let`. */
const EXCERPT_NOTE = /^\s*\|\s+[|`]- (note: .*)$/

/** The source excerpt and its markers: the diagnostic above already names the file, line and column. */
const EXCERPT = /^\s*(\d+ )?\|/

/** A line in the form the model reads: an excerpt note as `  note: ...`, and a trailing diagnostic group link gone. */
function shown(line: string): string {
  const note = EXCERPT_NOTE.exec(line)
  return (note === null ? line : `  ${note[1]}`).replace(/ \[#\w+\]$/, '')
}

/** The kept lines with every repeat after the first gone: both compiler passes print each diagnostic. */
function once(lines: string[]): FilterResult {
  const out = [...new Set(lines.map(shown))]
  const c = capped(out, CAP_INVENTORY, 'more lines')
  return { text: c.lines.join('\n'), elided: c.elided }
}

// ---------------------------------------------------------------------------------------------- swift

/** `swift build` and `swift test` lines that report nothing: progress, compiler invocations, passing tests. */
const SWIFT_NOISE = /^(\[\d+\/\d+\] |Building for |\[Planning|Planning build|Compiling |Emitting module|Write |Failed frontend command:|\[#\w+\]: <|error: \S+ normal \S+ .*Command line:|Test Case '.*' (started|passed)|Test Suite '.*' (started|passed)|◇ |✔ Test (?!run))|^\s+(cd |builtin-)|^\/\S+ -frontend | swift-frontend /

function swift(input: { text: string }): FilterResult {
  const lines = linesOf(input.text).filter(l => l.trim() !== '' && !SWIFT_NOISE.test(l) && (!EXCERPT.test(l) || EXCERPT_NOTE.test(l)))
  return once(lines)
}

// ------------------------------------------------------------------------------------------ xcodebuild

/** The xcodebuild lines worth reading: diagnostics, their notes, failed tests, the verdict, the failed commands. */
const XCODE_KEPT = /^(\S.*:\d+(:\d+)?: (error|warning): |(error|warning): |xcodebuild: error|\*\* .* \*\*$|The following build commands failed:|\t|\(\d+ failures?\)|Test Case '.*' failed|Executed \d+ tests?|Testing failed:|\s*\|\s+[|`]- note: )/

function xcodebuild(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  if (!lines.some(l => /^\*\* .* \*\*$/.test(l) || DIAGNOSTIC.test(l))) return cleanup(input.text)
  return once(lines.filter(l => XCODE_KEPT.test(l)))
}

export const APPLE: FilterTable = {
  'swift build': { run: swift },
  'swift test': { run: swift },
  xcodebuild: { run: xcodebuild },
}
