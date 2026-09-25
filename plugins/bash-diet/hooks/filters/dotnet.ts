import { plural } from './blocks.ts'
import { CAP_ERRORS, CAP_WARNINGS, capped, linesOf, type FilterResult, type FilterTable } from './common.ts'

/** `path(12,5): error CS0029: message [project]` */
const DIAGNOSTIC = /^(.+?\(\d+,\d+\)): (error|warning) (\w+): (.*?)(?: \[[^\]]+\])?$/

/** MSBuild and VSTest lines that report nothing: restore, project outputs, the test host's header. */
const DOTNET_NOISE = /^(Determining projects to restore|All projects are up-to-date|Restored |\S+ -> \/|\S+ -> [A-Z]:\\|Time Elapsed|MSBuild version|Microsoft \(R\)|Copyright \(C\)|Test run for |VSTest version|Starting test execution|A total of \d+ test files? matched|\[xUnit\.net |\[MSTest|NUnit Adapter|Passed \S+ \[|Build succeeded\.$|Build FAILED\.$|\d+ Warning\(s\)$|\d+ Error\(s\)$|Workload updates are available)/

/** A stack frame of the runtime or the test framework. */
const FRAMEWORK_FRAME = /^\s*at (System\.|Microsoft\.|Xunit\.|NUnit\.|Castle\.|Moq\.)/

/** The diagnostics once each (MSBuild repeats them in its summary), errors first, warnings capped. */
function diagnostics(lines: string[]): { lines: string[]; errors: number; warnings: number; elided: boolean } {
  const seen = new Map<string, { kind: string; text: string }>()
  for (const l of lines) {
    const m = DIAGNOSTIC.exec(l.trim())
    if (m !== null) seen.set(`${m[1]} ${m[3]}`, { kind: m[2] ?? '', text: `${m[1]}: ${m[2]} ${m[3]}: ${m[4]}` })
  }
  const of = (kind: string): string[] => [...seen.values()].filter(d => d.kind === kind).map(d => d.text)
  const errors = capped(of('error'), CAP_ERRORS, 'more errors')
  const warnings = capped(of('warning'), CAP_WARNINGS, 'more warnings')
  return { lines: [...errors.lines, ...warnings.lines], errors: of('error').length, warnings: of('warning').length, elided: errors.elided || warnings.elided }
}

/** The lines that are neither a diagnostic nor noise: test failures, their messages, other errors. */
const restOf = (lines: string[]): string[] =>
  lines.filter(l => l.trim() !== '' && !DIAGNOSTIC.test(l.trim()) && !DOTNET_NOISE.test(l.trim()) && !FRAMEWORK_FRAME.test(l))

/** A failed test starts with `  Failed Name [3 ms]`; the tests past the cap go. */
function cappedTests(lines: string[]): { lines: string[]; over: number } {
  const starts = lines.map((l, i) => (/^\s*Failed \S+ \[/.test(l) ? i : -1)).filter(i => i >= 0)
  if (starts.length <= CAP_WARNINGS) return { lines, over: 0 }
  const cut = starts[CAP_WARNINGS] ?? lines.length
  return { lines: [...lines.slice(0, cut), ...lines.slice(cut).filter(l => /^(Failed!|Passed!)/.test(l.trim()))], over: starts.length - CAP_WARNINGS }
}

/** `dotnet build`, `test`, `format` and `publish`: diagnostics once each, failed tests, and the result. */
function dotnet(input: { text: string; exitCode: number }): FilterResult {
  const lines = linesOf(input.text)
  const d = diagnostics(lines)
  const t = cappedTests(restOf(lines).map(l => l.replace(/:\s{2,}/g, ': ')))
  const verdict = lines.some(l => l.trim() === 'Build FAILED.') ? 'build failed' : lines.some(l => l.trim() === 'Build succeeded.') ? 'build succeeded' : undefined
  const counts = verdict === undefined ? [] : [`${verdict}: ${plural(d.errors, 'error')}, ${plural(d.warnings, 'warning')}`]
  const tail = t.over > 0 ? [`… +${t.over} more failed tests`] : []
  return { text: [...d.lines, ...t.lines, ...tail, ...counts].join('\n'), elided: d.elided || t.over > 0 }
}

export const DOTNET: FilterTable = {
  'dotnet build': { run: dotnet },
  'dotnet test': { run: dotnet },
  'dotnet format': { run: dotnet },
  'dotnet publish': { run: dotnet },
  'dotnet pack': { run: dotnet },
  'dotnet restore': { run: dotnet },
}
