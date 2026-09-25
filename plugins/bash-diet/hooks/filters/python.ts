import { byRule, plural, type Issue } from './blocks.ts'
import { CAP_INVENTORY, CAP_LIST, capped, hasArg, linesOf, whole, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

// ---------------------------------------------------------------------------------------------- pytest

/** How many failure sections pytest's report keeps. */
const MAX_FAILURES = 10

/**
 * A section rule: `==== FAILURES ====`, `____ test_x ____`. Pytest centres the title, so the two runs can
 * differ by one character; each side is its own run of the same character.
 */
const RULE = /^(=+|_+) (.*?) (?:=+|_+)$/

type Report = { sections: Map<string, string[]>; current?: string; summary: string[] }

/** The result line: `2 failed, 1 passed in 0.01s`, inside a rule by default and bare under `-q`. */
const RESULT = /\d+ (passed|failed|errors?|skipped|deselected|xfailed|xpassed|warnings?)\b.* in [\d.]+s|no tests ran/

/** A `=== name ===` rule: the result line, or the start of a section. */
function sectionRule(r: Report, name: string): void {
  if (RESULT.test(name)) {
    r.summary.push(name)
    r.current = undefined
    return
  }
  r.current = name
  r.sections.set(name, [])
}

function reportLine(r: Report, line: string): void {
  const rule = RULE.exec(line)
  if (rule?.[1]?.startsWith('=')) return sectionRule(r, rule[2] ?? '')
  if (rule === null && RESULT.test(line) && !line.startsWith(' ')) return sectionRule(r, line.trim())
  if (r.current !== undefined) r.sections.get(r.current)?.push(line)
}

/** The failure sections cut to `MAX_FAILURES` tests. */
function failures(lines: string[]): { lines: string[]; elided: boolean } {
  const starts = lines.map((l, i) => (/^_+ .* _+$/.test(l) ? i : -1)).filter(i => i >= 0)
  if (starts.length <= MAX_FAILURES) return { lines, elided: false }
  const end = starts[MAX_FAILURES] ?? lines.length
  return { lines: [...lines.slice(0, end), `… +${starts.length - MAX_FAILURES} more failures`], elided: true }
}

/** A pytest run: the failure and error sections, the short summary, and the result line; progress dots go. */
function pytest(input: { text: string }): FilterResult {
  const r: Report = { sections: new Map(), summary: [] }
  for (const line of linesOf(input.text)) reportLine(r, line)
  if (r.summary.length === 0) return cleanup(input.text)
  const kept = ['ERRORS', 'FAILURES', 'short test summary info'].filter(k => r.sections.has(k))
  let elided = false
  const out: string[] = []
  for (const name of kept) {
    const body = name === 'FAILURES' ? failures(r.sections.get(name) ?? []) : { lines: r.sections.get(name) ?? [], elided: false }
    out.push(`== ${name} ==`, ...body.lines)
    elided ||= body.elided
  }
  return { text: [...out, `pytest: ${r.summary.join('; ')}`].join('\n'), elided }
}

/** A short traceback, quiet progress and the xfail/xpass summary, unless the arguments choose their own. */
function pytestFlags(args: string[]): string[] | undefined {
  if (hasArg(args, '--tb', '-q', '--quiet', '-v', '--verbose', '-r', '--collect-only', '--co')) return undefined
  return ['--tb=short', '-q']
}

// -------------------------------------------------------------------------------------------- linters

/** `path:1:2: E501 Line too long` */
const RUFF_LINE = /^(.+?):\d+:\d+: ([A-Z]+\d+) (.*)$/

function ruffJson(text: string): Issue[] | undefined {
  try {
    const rows = JSON.parse(text) as { code?: string; message?: string; filename?: string }[]
    return Array.isArray(rows) ? rows.map(r => ({ file: r.filename ?? '', code: r.code ?? 'syntax', text: r.message ?? '' })) : undefined
  } catch {
    return undefined
  }
}

/** The full text format: `F401 [*] message` on one line, ` --> file:1:8` on the next. */
function ruffFull(lines: string[]): Issue[] {
  return lines.flatMap((l, i) => {
    const head = /^([A-Z]+\d+) (?:\[\*\] )?(.*)$/.exec(l)
    const at = /^\s*--> (.+?):\d+:\d+$/.exec(lines[i + 1] ?? '')
    return head === null || at === null ? [] : [{ file: at[1] ?? '', code: head[1] ?? '', text: head[2] ?? '' }]
  })
}

/** The concise text format, one issue a line. */
const ruffConcise = (lines: string[]): Issue[] =>
  lines.map(l => RUFF_LINE.exec(l)).filter(m => m !== null).map(m => ({ file: m[1] ?? '', code: m[2] ?? '', text: m[3] ?? '' }))

function ruff(input: { args: string[]; text: string; exitCode: number }): FilterResult {
  if (input.args[0] === 'format' || hasArg(input.args, '--statistics', '--show-fixes')) return cleanup(input.text)
  const fromJson = input.text.trimStart().startsWith('[') ? ruffJson(input.text) : undefined
  const lines = linesOf(input.text)
  const issues = fromJson ?? [...ruffConcise(lines), ...ruffFull(lines)]
  if (issues.length === 0) return input.exitCode === 0 ? whole(['ruff: no issues']) : cleanup(input.text)
  return byRule(issues, 'ruff')
}

/** `path:12: error: Message  [code]` */
const MYPY_LINE = /^(.+?):\d+(?::\d+)?: error: (.*?)(?:\s+\[([\w-]+)\])?$/

function mypy(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  const issues = lines.map(l => MYPY_LINE.exec(l)).filter(m => m !== null).map(m => ({ file: m[1] ?? '', code: m[3] ?? 'error', text: m[2] ?? '' }))
  if (issues.length === 0) return cleanup(input.text)
  return byRule(issues, 'mypy')
}

// ------------------------------------------------------------------------------------------ packages

/** `pip list`: `Package Version` rows as one `name version` list. */
function pipList(input: { text: string }): FilterResult {
  const rows = linesOf(input.text).filter(l => !/^(Package|-{3,})/.test(l) && l.trim() !== '')
  const c = capped(rows.map(r => r.trim().split(/\s+/).slice(0, 2).join(' ')), CAP_INVENTORY, 'packages')
  return { text: [`${plural(rows.length, 'package')}:`, ...c.lines].join('\n'), elided: c.elided }
}

/** `pip list --outdated`: `name current → latest`. */
function pipOutdated(input: { text: string }): FilterResult {
  const rows = linesOf(input.text).filter(l => !/^(Package|-{3,})/.test(l) && l.trim() !== '')
  const c = capped(rows.map(r => { const [n, cur, latest] = r.trim().split(/\s+/); return `${n} ${cur} → ${latest}` }), CAP_LIST, 'packages')
  return { text: [`${plural(rows.length, 'outdated package')}:`, ...c.lines].join('\n'), elided: c.elided }
}

/** An install: resolving, downloading and already-satisfied lines go; what changed and every error stay. */
const INSTALL_NOISE = /^\s*(Requirement already satisfied|Collecting|Downloading|Using cached|Obtaining|Preparing metadata|Building wheel|Created wheel|Stored in directory|Looking in indexes|Resolved \d+ packages?|Prepared \d+ packages?|Audited \d+ packages?|Downloaded \S+|Installing collected packages|Attempting uninstall|Found existing installation|Uninstalling|Successfully uninstalled|━)/

const install = (input: { text: string }): FilterResult => whole(linesOf(input.text).filter(l => !INSTALL_NOISE.test(l) && !/^\s*[━╸─]+/.test(l)))

/** `pip list` with the arguments after `list`: outdated packages, the list, or a format of its own. */
function listing(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, '--outdated', '-o')) return pipOutdated(input)
  return hasArg(input.args, '--format') ? cleanup(input.text) : pipList(input)
}

const INSTALLS = ['install', 'uninstall', 'sync', 'download']

/** `uv pip <sub>`: the subcommand is the first argument here, because `pip` is uv's own subcommand. */
function uvPip(input: { args: string[]; text: string; exitCode: number }): FilterResult {
  const [sub = '', ...rest] = input.args
  if (sub === 'list') return listing({ ...input, args: rest })
  return INSTALLS.includes(sub) ? install(input) : cleanup(input.text)
}

/** `pip` and `pip3`: the subcommand is classified apart from the arguments, so each has its own entry. */
const PIP: FilterTable = Object.fromEntries(['pip', 'pip3'].flatMap(tool => [
  [`${tool} list`, { run: listing }],
  ...INSTALLS.map(sub => [`${tool} ${sub}`, { run: install }]),
]))

export const PYTHON: FilterTable = {
  ...PIP,
  pytest: { run: pytest, flags: pytestFlags },
  'ruff check': { run: ruff },
  'ruff format': { run: ({ text }) => cleanup(text) },
  ruff: { run: ruff },
  mypy: { run: mypy },
  pip: { run: ({ text }) => cleanup(text) },
  pip3: { run: ({ text }) => cleanup(text) },
  'uv pip': { run: uvPip },
  'uv sync': { run: install },
  'uv add': { run: install },
  'uv lock': { run: install },
  'poetry install': { run: install },
  'poetry add': { run: install },
  'poetry update': { run: install },
}
