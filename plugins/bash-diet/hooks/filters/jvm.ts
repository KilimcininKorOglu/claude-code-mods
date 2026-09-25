import { CAP_WARNINGS, collapseBlanks, collapseRepeats, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** A stack frame of the test framework, the JDK or the build tool: it names none of the project's code. */
const FRAMEWORK_FRAME = /^\s*at (org\.junit\.|org\.opentest4j\.|org\.testng\.|org\.apache\.maven\.|org\.gradle\.|java\.|javax\.|jdk\.internal\.|sun\.|kotlin\.coroutines\.|scala\.|sbt\.|munit\.|org\.scalatest\.)/

// ----------------------------------------------------------------------------------------------- maven

/** Options that ask Maven for the whole log: a filter would take away what they asked for. */
const MVN_VERBOSE = ['-X', '--debug', '-e', '--errors']

/** `[INFO] text`; the daemon writes `[INFO]` with nothing after it for a blank line. */
const LEVEL = /^\[(INFO|WARNING|WARN|ERROR)\] ?(.*)$/

/** The help block Maven writes after a failed goal. */
const MVN_HELP = /^(See |-> \[Help|Re-run Maven|To see the full stack trace|For more information|\[Help \d+\]|https?:\/\/)/

/** A test class that passed: `Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 s -- in a.B`. */
const PASSING_CLASS = /^Tests run: \d+, Failures: 0, Errors: 0, .* in /

/** A test class that failed, and one failed test inside it. */
const FAILING_CLASS = /^Tests run: \d+, .*<<< (FAILURE|ERROR)!/
const FAILED_TEST = / -- Time elapsed: .*<<< (FAILURE|ERROR)!$/

/** The `[INFO]` lines that carry a result: the test totals, the verdict, the time, the reactor rows. */
const INFO_KEPT = /^(Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$|BUILD (SUCCESS|FAILURE)$|Total time:|Reactor Summary|.+ \.{3,}.* (SUCCESS|FAILURE|SKIPPED)\b)/

type MvnState = {
  out: string[]
  /** Whether unprefixed lines belong to the `[ERROR]` or `[WARNING]` line above them (a trace, a javac note). */
  trail: boolean
  /** Whether the current failing class is past the cap, so its lines go. */
  skip: boolean
  classes: number
}

function mvnError(s: MvnState, body: string, line: string): void {
  s.trail = body !== '' && !MVN_HELP.test(body)
  if (!s.trail) return
  if (FAILING_CLASS.test(body)) {
    s.classes += 1
    s.skip = s.classes > CAP_WARNINGS
  }
  if (!(s.skip && (FAILING_CLASS.test(body) || FAILED_TEST.test(body)))) s.out.push(line)
}

function mvnInfo(s: MvnState, body: string): void {
  s.trail = false
  s.skip = false
  if (INFO_KEPT.test(body)) s.out.push(body)
}

function mvnLine(s: MvnState, line: string): void {
  const m = LEVEL.exec(line)
  if (m === null) {
    if (line.trim() === '') s.trail = false
    else if (s.trail && !s.skip && !FRAMEWORK_FRAME.test(line)) s.out.push(line)
    return
  }
  const body = m[2] ?? ''
  if (m[1] === 'ERROR') return mvnError(s, body, line)
  if (m[1] === 'INFO' || PASSING_CLASS.test(body)) return mvnInfo(s, body)
  s.out.push(line)
  s.trail = true
}

/**
 * A Maven build: errors with their traces, warnings, the failing test classes and the verdict; the phase
 * headers, downloads and passing classes go. Output with no English verdict line is left to the cleanup,
 * because the patterns read English.
 */
function mvn(input: { args: string[]; text: string }): FilterResult {
  const lines = linesOf(input.text)
  if (hasArg(input.args, ...MVN_VERBOSE) || !lines.some(l => /BUILD (SUCCESS|FAILURE)$/.test(l))) return cleanup(input.text)
  const s: MvnState = { out: [], trail: false, skip: false, classes: 0 }
  for (const line of lines) mvnLine(s, line)
  const over = s.classes - CAP_WARNINGS
  const tail = over > 0 ? [`… +${over} more failing test classes`] : []
  return { text: [...collapseRepeats(s.out), ...tail].join('\n'), elided: over > 0 }
}

// ---------------------------------------------------------------------------------------------- gradle

/** Gradle lines that report nothing: tasks with no work, passing tests, the daemon, the help block. */
const GRADLE_NOISE = /^(> Task \S+( (UP-TO-DATE|NO-SOURCE|SKIPPED|FROM-CACHE))?$|> Configure project|\d+ actionable tasks?:|Deprecated Gradle features|You can use '--warning-mode|For more on this, please refer|> Run with --|\* Try:|\* Get more help|Starting a Gradle Daemon|Daemon will be stopped|Download(ing)? https?:|<-*> \d+% |.* > .* (PASSED|SKIPPED)$)/

function gradle(input: { text: string }): FilterResult {
  const kept = linesOf(input.text).filter(l => !GRADLE_NOISE.test(l.trim()) && !FRAMEWORK_FRAME.test(l))
  return whole(collapseBlanks(kept).filter((l, i) => i > 0 || l.trim() !== ''))
}

// ------------------------------------------------------------------------------------------------- sbt

/** The `[info]` lines of a result: the counts and the verdict. */
const SBT_SUMMARY = /^(Total number of tests run|Suites: completed|Tests: succeeded|\*\*\* \d+ TESTS? FAILED|All tests passed|Passed: Total|Failed: Total|Run completed)/

/** A failed test: ScalaTest's `*** FAILED ***`, MUnit's `==> X`. */
const SBT_FAILED = /\*\*\* FAILED \*\*\*|==> X /

type SbtState = { out: string[]; suite?: string; suiteShown: boolean; detail: number }

const indentOf = (text: string): number => text.length - text.trimStart().length

function sbtInfo(s: SbtState, body: string, line: string): void {
  if (/^\S.*:$/.test(body)) {
    s.suite = line
    s.suiteShown = false
    s.detail = -1
  } else if (SBT_FAILED.test(body)) {
    if (!s.suiteShown && s.suite !== undefined) s.out.push(s.suite)
    s.suiteShown = true
    s.out.push(line)
    s.detail = indentOf(body)
  } else if (s.detail >= 0 && indentOf(body) > s.detail) s.out.push(line)
  else {
    s.detail = -1
    if (SBT_SUMMARY.test(body)) s.out.push(line)
  }
}

/** sbt: every error and warning, the failed tests under their suite with their message, and the counts. */
function sbt(input: { text: string }): FilterResult {
  const s: SbtState = { out: [], suiteShown: false, detail: -1 }
  for (const line of linesOf(input.text)) {
    const m = /^\[(info|warn|error|success)\] ?(.*)$/.exec(line)
    if (m?.[1] === 'info') sbtInfo(s, m[2] ?? '', line)
    else if (m !== null || line.trim() !== '') s.out.push(line)
  }
  return whole(collapseRepeats(s.out))
}

export const JVM: FilterTable = {
  mvn: { run: mvn },
  mvnd: { run: mvn },
  gradle: { run: gradle },
  gradlew: { run: gradle },
  sbt: { run: sbt },
}
