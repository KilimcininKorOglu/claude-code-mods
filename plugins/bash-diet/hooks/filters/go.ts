import { plural } from './blocks.ts'
import { CAP_ERRORS, capped, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** One event of `go test -json`. */
type Event = { Action?: string; Package?: string; Test?: string; Output?: string; Elapsed?: number }

type Pkg = { passed: number; failed: number; skipped: number; result?: string; elapsed?: number; output: string[]; tests: Map<string, string[]>; failedTests: string[] }

type Run = { pkgs: Map<string, Pkg>; plain: string[] }

/** Lines of a test's output that only mark its progress. */
const NOISE = /^\s*(=== (RUN|PAUSE|CONT|NAME)|--- (PASS|SKIP):)/

function pkgOf(r: Run, name: string): Pkg {
  let p = r.pkgs.get(name)
  if (p === undefined) {
    p = { passed: 0, failed: 0, skipped: 0, output: [], tests: new Map(), failedTests: [] }
    r.pkgs.set(name, p)
  }
  return p
}

/** A test's own event: its output, or its verdict. */
function testEvent(p: Pkg, e: Event & { Test: string }): void {
  if (e.Action === 'output') {
    const out = p.tests.get(e.Test) ?? []
    out.push((e.Output ?? '').replace(/\n$/, ''))
    p.tests.set(e.Test, out)
    return
  }
  if (e.Action === 'pass') p.passed += 1
  else if (e.Action === 'skip') p.skipped += 1
  else if (e.Action === 'fail') { p.failed += 1; p.failedTests.push(e.Test) }
}

function event(r: Run, e: Event): void {
  const p = pkgOf(r, e.Package ?? '')
  if (e.Test !== undefined) return testEvent(p, e as Event & { Test: string })
  if (e.Action === 'output') p.output.push((e.Output ?? '').replace(/\n$/, ''))
  else if (e.Action === 'pass' || e.Action === 'fail' || e.Action === 'skip') { p.result = e.Action; p.elapsed = e.Elapsed }
}

/** One line: an event when it parses, else a line go printed outside the stream (a build error). */
function line(r: Run, text: string): void {
  if (!text.startsWith('{')) { if (text.trim() !== '') r.plain.push(text); return }
  try {
    event(r, JSON.parse(text) as Event)
  } catch {
    r.plain.push(text)
  }
}

/** A failed package: its failed tests with their output, or its own output when no test failed (a build or a panic). */
function failedPkg(name: string, p: Pkg): string[] {
  const head = `FAIL ${name}${p.elapsed === undefined ? '' : ` (${p.elapsed}s)`}: ${p.failed} failed, ${p.passed} passed`
  const tests = p.failedTests.flatMap(t => (p.tests.get(t) ?? []).filter(l => !NOISE.test(l)).map(l => `  ${l.trim() === '' ? '' : l}`))
  const own = p.failedTests.length === 0 ? p.output.filter(l => !/^(FAIL|ok)\s/.test(l) && !NOISE.test(l)).map(l => `  ${l}`) : []
  return [head, ...tests, ...own]
}

function summaryOf(r: Run): string {
  const all = [...r.pkgs.values()]
  const sum = (k: 'passed' | 'failed' | 'skipped'): number => all.reduce((n, p) => n + p[k], 0)
  const skipped = sum('skipped') > 0 ? `, ${sum('skipped')} skipped` : ''
  return `go test: ${sum('passed')} passed, ${sum('failed')} failed${skipped} in ${plural(all.length, 'package')}`
}

function testJson(input: { text: string }): FilterResult {
  const r: Run = { pkgs: new Map(), plain: [] }
  for (const l of linesOf(input.text)) line(r, l)
  r.pkgs.delete('')
  if (r.pkgs.size === 0) return whole(r.plain)
  const failed = [...r.pkgs].filter(([, p]) => p.result === 'fail' || p.failed > 0)
  const c = capped(failed.flatMap(([name, p]) => failedPkg(name, p)), CAP_ERRORS * 10, 'lines')
  return { text: [...r.plain, ...c.lines, summaryOf(r)].join('\n'), elided: c.elided }
}

/** The text format: progress and passing lines go, `ok` packages become a count. */
function testText(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  const ok = lines.filter(l => /^ok\s/.test(l))
  const kept = lines.filter(l => !NOISE.test(l) && !/^ok\s/.test(l) && l !== 'PASS' && !/^\?\s+\S+\s+\[no test files\]/.test(l))
  return whole([...kept, `${plural(ok.length, 'package')} ok`])
}

function test(input: { args: string[]; text: string }): FilterResult {
  return hasArg(input.args, '-json') || input.text.trimStart().startsWith('{') ? testJson(input) : testText(input)
}

/** golangci-lint's text report: one line per issue with its linter, the source frames gone. */
function lint(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  const issues = lines.filter(l => /^\S+:\d+(:\d+)?: .*\(\S+\)$/.test(l))
  if (issues.length === 0) return cleanup(input.text)
  const counts = new Map<string, number>()
  for (const i of issues) { const linter = /\((\S+)\)$/.exec(i)?.[1] ?? '?'; counts.set(linter, (counts.get(linter) ?? 0) + 1) }
  const c = capped(issues, CAP_ERRORS * 2, 'issues')
  const byLinter = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
  return { text: [...c.lines, `${plural(issues.length, 'issue')}: ${byLinter}`].join('\n'), elided: c.elided }
}

/** `go: downloading x v1.2.3` lines go; what was added, upgraded or failed stays. */
const modOp = (input: { text: string }): FilterResult => whole(linesOf(input.text).filter(l => !/^go: (downloading|finding|extracting) /.test(l)))

export const GO: FilterTable = {
  'go test': { run: test, flags: args => (hasArg(args, '-json') ? undefined : ['-json']) },
  'go build': { run: modOp },
  'go vet': { run: modOp },
  'go get': { run: modOp },
  'go mod': { run: modOp },
  'go install': { run: modOp },
  'golangci-lint run': { run: lint },
  'golangci-lint': { run: lint },
}
