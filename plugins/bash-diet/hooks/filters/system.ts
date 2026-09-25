import { plural } from './blocks.ts'
import { CAP_INVENTORY, capped, cutLine, hasArg, linesOf, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/** Directories whose contents are generated or vendored; a listing names them without their size or rows. */
export const NOISE_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.parcel-cache', '.gradle', 'DerivedData', 'Pods', 'coverage', '.cache'])

/** How many matches a search shows per file and in all, and how long a match line may be. */
const GREP_PER_FILE = 25
const GREP_TOTAL = 200
const GREP_LINE = 160

// ------------------------------------------------------------------------------------------------ ls

/** One `ls -l` row: its type, size and name; the date, owner and link count go. */
function longRow(line: string): string | undefined {
  const m = /^([dlcbps-])[rwxsStT-]{9}[@+.]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w+\s+\d+\s+[\d:]+\s+(.+)$/.exec(line)
  if (m === null) return undefined
  const name = m[3] ?? ''
  if (name === '.' || name === '..') return ''
  if (m[1] === 'd') return `${name}/`
  if (m[1] === 'l') return name.replace(/ -> .*/, ' →')
  return `${name}  ${humanSize(Number(m[2]))}`
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

/** A listing: directories first with a slash, files with their size, noise directories named only. */
function ls(input: { args: string[]; text: string }): FilterResult {
  const lines = linesOf(input.text).filter(l => !/^total \d+/.test(l) && l.trim() !== '')
  if (lines.some(l => /^\S+:$/.test(l))) return cleanup(input.text)
  const rows = lines.map(l => longRow(l) ?? l).filter(r => r !== '')
  const noise = rows.filter(r => NOISE_DIRS.has(r.replace(/\/$/, '')))
  const kept = rows.filter(r => !noise.includes(r))
  const sorted = [...kept.filter(r => r.endsWith('/')), ...kept.filter(r => !r.endsWith('/'))]
  const c = capped(sorted, CAP_INVENTORY, 'entries')
  return { text: [...c.lines, ...(noise.length > 0 ? [`(${noise.join(' ')} not listed)`] : [])].join('\n'), elided: c.elided }
}

// ---------------------------------------------------------------------------------------------- find

/** find's options whose output is not one path a line. */
const FIND_OWN_FORMAT = ['-exec', '-execdir', '-print0', '-printf', '-fprintf', '-ls', '-fls', '-delete', '-ok', '-okdir']

/** Paths grouped by their directory, with a count per extension. */
function find(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, ...FIND_OWN_FORMAT)) return cleanup(input.text)
  const paths = linesOf(input.text).filter(l => l.trim() !== '' && !l.startsWith('find: '))
  const errors = linesOf(input.text).filter(l => l.startsWith('find: '))
  const dirs = new Map<string, string[]>()
  for (const p of paths) {
    const slash = p.lastIndexOf('/')
    const dir = slash < 0 ? '.' : p.slice(0, slash) || '/'
    dirs.set(dir, [...(dirs.get(dir) ?? []), p.slice(slash + 1)])
  }
  const lines = [...dirs].map(([dir, names]) => cutLine(`${dir}/ ${names.join(' ')}`, 400))
  const c = capped(lines, CAP_INVENTORY, 'directories')
  return { text: [...errors.slice(0, 5), ...c.lines, `${plural(paths.length, 'path')} in ${plural(dirs.size, 'directory', 'directories')}`].join('\n'), elided: c.elided }
}

// ---------------------------------------------------------------------------------------------- grep

/** grep's and rg's options whose output is not `file:line:text`. */
const GREP_OWN_FORMAT = ['-l', '-L', '-c', '-o', '-q', '--files-with-matches', '--files-without-match', '--count', '--only-matching', '--quiet', '--files', '--json', '--count-matches', '-A', '-B', '-C', '--context', '--after-context', '--before-context', '--heading', '--vimgrep', '-Z', '--null']

type Match = { file: string; rest: string }

/** `path:12:text` or `path:text`, as grep -rn, grep -r and rg print it without a terminal. */
function matchOf(line: string): Match | undefined {
  const m = /^([^:\n]+?):(\d+:)?(.*)$/.exec(line)
  if (m === null || /^\s/.test(line)) return undefined
  return { file: m[1] ?? '', rest: `${m[2] ?? ''}${m[3] ?? ''}` }
}

/** Matches grouped by file, each file capped, long lines cut, and a count of what was left out. */
function grep(input: { args: string[]; text: string }): FilterResult {
  if (hasArg(input.args, ...GREP_OWN_FORMAT)) return cleanup(input.text)
  const lines = linesOf(input.text).filter(l => l !== '')
  const matches = lines.map(matchOf)
  if (matches.some(m => m === undefined) || new Set(matches.map(m => m?.file)).size < 2) return cleanup(input.text)
  const files = new Map<string, string[]>()
  for (const m of matches as Match[]) files.set(m.file, [...(files.get(m.file) ?? []), m.rest])
  let shown = 0
  const out: string[] = []
  for (const [file, rows] of files) {
    const room = Math.max(0, Math.min(GREP_PER_FILE, GREP_TOTAL - shown))
    if (room === 0) break
    out.push(`${file} (${rows.length}):`, ...rows.slice(0, room).map(r => `  ${cutLine(r, GREP_LINE)}`), ...(rows.length > room ? [`  … +${rows.length - room} more in this file`] : []))
    shown += Math.min(room, rows.length)
  }
  const elided = shown < matches.length
  return { text: [...out, `${plural(matches.length, 'match', 'matches')} in ${plural(files.size, 'file')}${elided ? `, ${shown} shown` : ''}`].join('\n'), elided }
}

// ------------------------------------------------------------------------------------ env and processes

/** A variable whose value may be a credential. */
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|AUTH|SESSION|COOKIE)/i

/** A `NAME=value` word or line. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** A `NAME=value` row with a credential's value masked, else cut to one line. */
function envRow(row: string): string {
  const at = row.indexOf('=')
  return SECRET_NAME.test(row.slice(0, at)) && row.slice(at + 1) !== '' ? `${row.slice(0, at)}=***` : cutLine(row, 160)
}

/**
 * `env` and `printenv`: sorted, credentials masked, long values cut. `env FOO=1` lists the whole
 * environment too; a name (`printenv HOME`) prints one value, which is left to the cleanup.
 */
function env(input: { args: string[]; text: string }): FilterResult {
  if (input.args.some(a => !a.startsWith('-') && !ASSIGNMENT.test(a))) return cleanup(input.text)
  const rows = linesOf(input.text).filter(l => ASSIGNMENT.test(l)).sort()
  const shown = rows.map(envRow)
  const masked = shown.some(s => s.endsWith('=***'))
  return { text: shown.join('\n'), elided: shown.some((s, i) => s !== rows[i]), ...(masked ? { redacted: true as const } : {}) }
}

/** `ps` rows cut to one line each and capped. */
function ps(input: { text: string }): FilterResult {
  const c = capped(linesOf(input.text).map(l => cutLine(l, 160)), CAP_INVENTORY, 'processes')
  return { text: c.lines.join('\n'), elided: c.elided || input.text.split('\n').some(l => l.length > 160) }
}

/** `tree`: the first lines and the summary line. */
function tree(input: { text: string }): FilterResult {
  const lines = linesOf(input.text)
  const summary = lines.filter(l => /^\d+ director(y|ies)(, \d+ files?)?$/.test(l.trim()))
  const body = lines.filter(l => !summary.includes(l) && !NOISE_DIRS.has(l.replace(/^[│├└─\s]+/, '').trim()))
  const c = capped(body, CAP_INVENTORY * 2, 'lines')
  return { text: [...c.lines, ...summary].join('\n'), elided: c.elided }
}

export const SYSTEM: FilterTable = {
  ls: { run: ls },
  find: { run: find },
  grep: { run: grep },
  egrep: { run: grep },
  rg: { run: grep },
  'ast-grep': { run: grep },
  env: { run: env },
  printenv: { run: env },
  ps: { run: ps },
  tree: { run: tree },
}
