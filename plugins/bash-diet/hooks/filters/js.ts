import { byRule, plural, type Issue } from './blocks.ts'
import { CAP_ERRORS, CAP_INVENTORY, CAP_LIST, capped, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** npm's own chatter: notices, the `> pkg@1.0.0 script` header, and funding and audit nags. */
const NPM_NOISE = /^npm (notice|verb|http|timing|sill)\b|^> \S+@\S+ \S+|^> |^\d+ packages? (are|is) looking for funding|^\s*run `npm fund`|^Run `npm audit` for details|^npm warn (config|using --force)/

/** How many lines of one failure message a test report keeps. */
const FAILURE_LINES = 12

// -------------------------------------------------------------------------------------- package managers

/** An npm run, exec or install: npm's chatter goes, deprecation warnings become one count. */
function npm(input: { text: string }): FilterResult {
  const lines = linesOf(input.text).filter(l => !NPM_NOISE.test(l))
  const deprecated = lines.filter(l => /^npm warn deprecated /.test(l)).length
  const kept = lines.filter(l => !/^npm warn deprecated /.test(l) && l.trim() !== '')
  const tail = deprecated > 0 ? [`(${plural(deprecated, 'deprecation warning')})`] : []
  return whole([...(kept.length === 0 && tail.length === 0 ? ['ok'] : kept), ...tail])
}

/** A dependency tree: the rows, capped. */
function tree(input: { text: string }): FilterResult {
  const rows = linesOf(input.text).filter(l => l.trim() !== '' && !/^Legend:/.test(l) && !NPM_NOISE.test(l))
  const c = capped(rows, CAP_INVENTORY, 'rows')
  return { text: c.lines.join('\n'), elided: c.elided }
}

/** pnpm, bun and yarn installs: progress lines and bars go; what was added and every warning stay. */
function install(input: { text: string }): FilterResult {
  const kept = linesOf(input.text).filter(l => l.trim() !== '' && !/^(Progress: |Packages: [+-]|[+-]{2,}$|Already up to date|Lockfile is up to date|Resolving dependencies|Resolved, downloaded and extracted|\[\d+(\.\d+)?m?s\] )/.test(l.trim()) && !NPM_NOISE.test(l))
  return whole(kept.length === 0 ? ['ok'] : kept)
}

function pnpm(input: { args: string[]; text: string; exitCode: number }): FilterResult {
  const sub = input.args.find(a => !a.startsWith('-')) ?? ''
  if (['list', 'ls', 'outdated', 'why'].includes(sub)) return tree(input)
  if (['install', 'i', 'add', 'remove', 'rm', 'update', 'up'].includes(sub)) return install(input)
  return npm(input)
}

// ------------------------------------------------------------------------------------------- tests

type Assertion = { fullName?: string; title?: string; status?: string; failureMessages?: string[] }
type Suite = { name?: string; status?: string; message?: string; assertionResults?: Assertion[] }
type Report = { numPassedTests?: number; numFailedTests?: number; numPendingTests?: number; numTotalTestSuites?: number; testResults?: Suite[] }

/** The JSON report jest and vitest print, found after any line a script printed before it. */
function reportOf(text: string): Report | undefined {
  const at = text.indexOf('{"num')
  if (at < 0) return undefined
  try {
    return JSON.parse(text.slice(at, text.lastIndexOf('}') + 1)) as Report
  } catch {
    return undefined
  }
}

/** A failure message up to its stack, and the first frame outside node_modules. */
function failureLines(message: string): string[] {
  const lines = message.split('\n')
  const stackAt = lines.findIndex(l => /^\s+at /.test(l))
  const head = (stackAt < 0 ? lines : lines.slice(0, stackAt)).slice(0, FAILURE_LINES)
  const frame = lines.slice(Math.max(stackAt, 0)).find(l => /^\s+at /.test(l) && !/node_modules|node:internal|<anonymous>\)?$/.test(l))
  return [...head, ...(frame === undefined ? [] : [frame.trim()])].map(l => `  ${l}`)
}

function suiteFailures(s: Suite): string[] {
  const failed = (s.assertionResults ?? []).filter(a => a.status === 'failed')
  if (failed.length === 0 && s.status === 'failed' && s.message) return [`FAIL ${s.name ?? ''}`, ...failureLines(s.message)]
  return failed.flatMap(a => [`FAIL ${s.name ?? ''} > ${a.fullName ?? a.title ?? ''}`, ...failureLines((a.failureMessages ?? []).join('\n'))])
}

/** A JSON report as each failed test with its message, and one counting line. */
function fromReport(tool: string, r: Report): FilterResult {
  const failures = (r.testResults ?? []).flatMap(suiteFailures)
  const c = capped(failures, CAP_ERRORS * FAILURE_LINES, 'lines')
  const pending = (r.numPendingTests ?? 0) > 0 ? `, ${r.numPendingTests} skipped` : ''
  const summary = `${tool}: ${r.numPassedTests ?? 0} passed, ${r.numFailedTests ?? 0} failed${pending} (${plural(r.numTotalTestSuites ?? (r.testResults ?? []).length, 'file')})`
  return { text: [...c.lines, summary].join('\n'), elided: c.elided }
}

/** A test runner's text report: passing lines go; failure blocks and the summary stay. */
function testText(input: { text: string }): FilterResult {
  const lines = linesOf(input.text).filter(l => !NPM_NOISE.test(l))
  const kept = lines.filter(l => !/^\s*(✓|√|\(pass\)|ok \d+|PASS\s)/.test(l) && !/^\s*(RUN|Start at|Snapshots:|Ran all test suites|Duration)\b/.test(l.trim()) && !/^bun test v/.test(l))
  return whole(kept.filter((l, i) => l.trim() !== '' || (kept[i - 1] ?? '').trim() !== ''))
}

function tests(tool: string) {
  return (input: { args: string[]; text: string }): FilterResult => {
    const report = reportOf(input.text)
    return report === undefined ? testText(input) : fromReport(tool, report)
  }
}

const OWN_TEST_FORMAT = ['--json', '--reporter', '--outputFile', '--watch', '--coverage', '--listTests', '--showConfig', '--help', '--ui']

/** jest's `--json`, unless the arguments choose their own format or a watch mode. */
const jestFlags = (args: string[]): string[] | undefined => (hasArg(args, ...OWN_TEST_FORMAT, '--watchAll', '-w') ? undefined : ['--json'])

/** vitest's JSON reporter, for a `vitest run` only: a bare `vitest` watches. */
const vitestFlags = (args: string[]): string[] | undefined =>
  args[0] === 'run' && !hasArg(args, ...OWN_TEST_FORMAT) ? ['--reporter=json'] : undefined

// ---------------------------------------------------------------------------------------- compilers

/** `src/a.ts(1,14): error TS2322: Type ...` grouped by file, continuation lines kept. */
function tsc(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, '--pretty', '--watch', '-w', '--listFiles', '--showConfig')) return cleanup(input.text)
  const files = new Map<string, string[]>()
  let last: string[] | undefined
  let count = 0
  for (const line of linesOf(input.text).filter(l => !NPM_NOISE.test(l))) {
    const m = /^(.+?)\((\d+,\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line)
    if (m !== null) { last = files.get(m[1] ?? '') ?? []; files.set(m[1] ?? '', last); last.push(`  (${m[2]}) ${m[4]}: ${m[5]}`); count += 1 }
    else if (last !== undefined && /^\s/.test(line)) last.push(`  ${line}`)
  }
  if (count === 0) return cleanup(input.text)
  const lines = [...files].flatMap(([file, errs]) => [file, ...errs])
  const c = capped(lines, CAP_ERRORS * 5, 'lines')
  return { text: [...c.lines, `tsc: ${plural(count, 'error')} in ${plural(files.size, 'file')}`].join('\n'), elided: c.elided }
}

/** eslint's JSON: messages grouped by rule. */
function eslintJson(text: string): Issue[] | undefined {
  const at = text.indexOf('[{"filePath"')
  if (at < 0) return undefined
  try {
    const files = JSON.parse(text.slice(at, text.lastIndexOf(']') + 1)) as { filePath: string; messages: { ruleId: string | null; message: string }[] }[]
    return files.flatMap(f => f.messages.map(m => ({ file: f.filePath, code: m.ruleId ?? 'parse', text: m.message })))
  } catch {
    return undefined
  }
}

/** eslint's stylish text: a file line, then `  1:7  error  message  rule` rows. */
function eslintText(lines: string[]): Issue[] {
  let file = ''
  const issues: Issue[] = []
  for (const line of lines) {
    const row = /^\s+\d+:\d+\s+(error|warning)\s+(.*?)\s{2,}(\S+)$/.exec(line)
    if (row !== null) issues.push({ file, code: row[3] ?? '', text: row[2] ?? '' })
    else if (/^\S/.test(line) && !/^✖/.test(line)) file = line.trim()
  }
  return issues
}

function eslint(input: { args: string[]; text: string; exitCode: number }): FilterResult {
  const issues = eslintJson(input.text) ?? eslintText(linesOf(input.text))
  if (issues.length === 0) return input.exitCode === 0 ? whole(['eslint: no issues']) : cleanup(input.text)
  return byRule(issues, 'eslint')
}

/** `[warn] src/a.ts` lines as one list of the files prettier would change. */
function prettier(input: { args: string[]; text: string; exitCode: number }): FilterResult {
  const files = linesOf(input.text).map(l => /^\[warn\] (?!Code style issues)(.+)$/.exec(l)?.[1]).filter(f => f !== undefined)
  if (files.length === 0) return input.exitCode === 0 && hasArg(input.args, '--check', '-c') ? whole(['prettier: all files formatted']) : cleanup(input.text)
  const c = capped(files.map(f => `  ${f}`), CAP_LIST, 'files')
  return { text: [`prettier: ${plural(files.length, 'file')} need formatting`, ...c.lines].join('\n'), elided: c.elided }
}

/** A Next.js build: the route table becomes a count, progress lines go. */
function nextBuild(input: { text: string }): FilterResult {
  const lines = linesOf(input.text).filter(l => !NPM_NOISE.test(l))
  const routes = lines.filter(l => /^[┌├└│]\s|^[○ƒ●◐λ]\s/.test(l.trim()))
  const kept = lines.filter(l => !routes.includes(l) && !/^\s*(Collecting page data|Generating static pages|Finalizing page optimization|Collecting build traces|Creating an optimized production build|Linting and checking validity)/.test(l.trim()) && !/^\s*\+ First Load JS shared/.test(l))
  return whole([...kept.filter(l => l.trim() !== ''), ...(routes.length > 0 ? [`(${plural(routes.length, 'route line')} left out)`] : [])])
}

/** Prisma's boxed tips and update notices go; what it generated or migrated stays. */
const prisma = (input: { text: string }): FilterResult =>
  whole(linesOf(input.text).filter(l => !/^[┌│└─╭╮╰╯┐┘\s]*$/.test(l) && !/^\s*[│┃]/.test(l) && !/^(Tip:|Start (by|using)|Environment variables loaded|Prisma schema loaded)/.test(l.trim())))

/** Deno's download lines go. */
const deno = (input: { text: string }): FilterResult => whole(linesOf(input.text).filter(l => !/^(Download|Check|Compile) /.test(l) && !/ \.\.\. ok \(/.test(l)))

export const JS: FilterTable = {
  npm: { run: npm },
  'npm run': { run: npm },
  'npm test': { run: npm },
  'npm run-script': { run: npm },
  'npm exec': { run: npm },
  'npm install': { run: npm },
  'npm i': { run: npm },
  'npm ci': { run: npm },
  'npm ls': { run: tree },
  'npm list': { run: tree },
  'npm outdated': { run: tree },
  pnpm: { run: pnpm },
  'bun install': { run: install },
  'bun add': { run: install },
  'bun remove': { run: install },
  'bun test': { run: tests('bun test') },
  'yarn install': { run: install },
  'yarn add': { run: install },
  jest: { run: tests('jest'), flags: jestFlags },
  vitest: { run: tests('vitest'), flags: vitestFlags, flagsAtEnd: true },
  playwright: { run: ({ text }) => testText({ text }) },
  tsc: { run: tsc },
  eslint: { run: eslint, flags: args => (hasArg(args, '-f', '--format', '--fix', '--print-config', '--init') ? undefined : ['-f', 'json']) },
  prettier: { run: prettier },
  'next build': { run: nextBuild },
  prisma: { run: prisma },
  'deno test': { run: deno },
  'deno lint': { run: deno },
  'deno check': { run: deno },
}
