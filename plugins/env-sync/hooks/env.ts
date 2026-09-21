/** Which commands commit, the env variables a commit's added lines read, and which of them the reference file lacks. */

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit` the model runs, not one it only asks about. */
const COMMIT = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+commit\b`)
const NOT_A_COMMIT = /\s(--dry-run|--help|-h)(\s|$)/

export function isCommit(command: string): boolean {
  return COMMIT.test(command) && !NOT_A_COMMIT.test(command)
}

/** A `git commit`, `git push` or `git merge` the gate stops while a finding is open. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !NOT_A_COMMIT.test(command)
}

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/env-sync mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** What the deny says: why the command stopped, and the one setting that turns the gate off. */
export function denyText(open: readonly string[], reference: string): string {
  return `stopped: ${reference} still lacks ${open.length} variable(s): ${namedPlain(open)}. Add them with a placeholder value and run the command again; there is no way around this gate.`
}

const unquote = (word: string): string => word.replace(/^(["'])(.*)\1$/, '$2')

const joinDir = (base: string, dir: string): string => (dir.startsWith('/') ? dir : `${base.replace(/\/+$/, '')}/${dir}`)

/**
 * The directory the commit runs in: the session's directory, moved by the last `cd` before the commit and by
 * its `git -C`, because the hook reads the repository before the command's own `cd` has run.
 */
export function commitDir(command: string, cwd: string): string {
  const commit = COMMIT.exec(command)
  if (commit === null) return cwd
  const cds = [...command.slice(0, commit.index).matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g)]
  const lastCd = cds.at(-1)?.[1]
  const afterCd = lastCd === undefined ? cwd : joinDir(cwd, unquote(lastCd))
  return [...commit[0].matchAll(/-C\s+(\S+)/g)].reduce((dir, c) => joinDir(dir, unquote(c[1] ?? '.')), afterCd)
}

/** The reference files, in the order they are looked for at the repository root. */
export const REFERENCE_FILES = ['.env.example', '.env.sample', '.env.dist']

const NAME = '([A-Z][A-Z0-9_]*)'

/** One pattern per way a language reads an env variable; group 1 is the name. */
const READS = [
  new RegExp(`process\\.env\\.${NAME}\\b`, 'g'),
  new RegExp(`process\\.env\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.${NAME}\\b`, 'g'),
  new RegExp(`\\bos\\.environ(?:\\.get\\(|\\[)\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\bos\\.(?:getenv|Getenv|LookupEnv)\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`(?<![\\w$>.])(?:env|getenv)\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\$_ENV\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`\\benv::var(?:_os)?\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`\\bENV(?:\\.fetch\\(|\\[)\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\bSystem\\.getenv\\(\\s*"${NAME}"`, 'g'),
]

/** Variables the shell, the OS or the CI sets, which a project does not document. */
const SYSTEM = new Set(['NODE_ENV', 'HOME', 'PATH', 'USER', 'PWD', 'SHELL', 'TMPDIR', 'TERM', 'LANG', 'CI'])

/** PHP `$_SERVER`, which holds the env variables and also the web server's request values. */
const SERVER_READ = new RegExp(`\\$_SERVER\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g')

/** The request values in `$_SERVER`, which are not env variables. */
const SERVER_VALUE = /^(HTTP|REQUEST|SERVER|REMOTE|SCRIPT|PHP|CONTENT|DOCUMENT|QUERY|GATEWAY|PATH)_/

/** Prose files, whose examples are not reads. */
const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i

/** An env variable a line reads, with where the line is in the committed tree. */
export type EnvRead = { name: string; file: string; line: number }

/** The variables one line reads. */
export function lineReads(text: string): string[] {
  const names = READS.flatMap(re => [...text.matchAll(re)].map(m => m[1] ?? ''))
  const server = [...text.matchAll(SERVER_READ)].map(m => m[1] ?? '').filter(n => !SERVER_VALUE.test(n))
  return [...names, ...server].filter(n => n !== '' && !SYSTEM.has(n))
}

/** The file a `+++` line names, undefined for a deleted file or a prose file. */
function newFile(line: string): string | undefined {
  const path = line.slice(4).replace(/^b\//, '')
  return path === '/dev/null' || PROSE.test(path) ? undefined : path
}

/** The env reads on the added lines of a `git show --unified=0` diff, each name once at its first place. */
export function diffReads(diff: string): EnvRead[] {
  const reads = new Map<string, EnvRead>()
  let file: string | undefined
  let line = 0
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -\S+ \+(\d+)/.exec(text)
    if (text.startsWith('+++ ')) file = newFile(text)
    else if (hunk !== null) line = Number(hunk[1])
    else if (text.startsWith('+')) {
      for (const name of file === undefined ? [] : lineReads(text)) if (!reads.has(name)) reads.set(name, { name, file: file ?? '', line })
      line++
    }
  }
  return [...reads.values()]
}

/** The names a reference file lists: `X=`, `export X=` and a commented `# X=` count. */
export function listedNames(text: string): Set<string> {
  const names = [...text.matchAll(/^[ \t]*(?:#[ \t]*)?(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm)]
  return new Set(names.map(m => m[1] ?? ''))
}

/** At most this many variables are named in the note, the rest counted. */
const MAX_NAMED = 10

function namedReads(missing: readonly EnvRead[]): string {
  const named = missing.slice(0, MAX_NAMED).map(r => `${r.name} (${r.file}:${r.line})`)
  if (missing.length > MAX_NAMED) named.push(`${missing.length - MAX_NAMED} more`)
  return named.join(' · ')
}

export function noteText(missing: readonly EnvRead[], reference: string): string {
  return `env-sync: this commit reads env variables ${reference} lacks: ${namedReads(missing)}. Add them to ${reference} with a placeholder value, never a real secret.`
}

/** The transcript line: the variables alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(missing: readonly EnvRead[], reference: string): string {
  return `env variables ${reference} lacks: ${namedReads(missing)}`
}

/** One sidebar line per variable, so the section reads as a list. */
export function sidebarLines(missing: readonly EnvRead[]): { text: string; kind: 'error' }[] {
  return namedReads(missing).split(' · ').map(text => ({ text, kind: 'error' }))
}

/** Every variable a whole file reads, so a finding is measured against the file it came from. */
export function fileReads(text: string): Set<string> {
  return new Set(lineReads(text))
}

/** One open variable and the file whose added lines read it; the file is the measure that can close it. */
export type Open = { name: string; file: string }

/** The variables a finding holds open after a new report: the earlier ones and the new ones, each once. */
export function openReads(before: readonly Open[], missing: readonly EnvRead[]): Open[] {
  const out = new Map(before.map(o => [o.name, o]))
  for (const r of missing) if (!out.has(r.name)) out.set(r.name, { name: r.name, file: r.file })
  return [...out.values()]
}

function namedPlain(names: readonly string[]): string {
  const named = names.slice(0, MAX_NAMED)
  if (names.length > MAX_NAMED) named.push(`${names.length - MAX_NAMED} more`)
  return named.join(' · ')
}

/** The title of a closed finding, by what closed it. */
export function doneTitle(added: readonly string[], gone: readonly string[], reference: string): string {
  if (gone.length === 0) return `env variables ${reference} gained`
  return added.length === 0 ? 'env reads gone' : 'env variables settled'
}

/** The transcript line of a finding that closed: the variables the reference file gained, the reads the code dropped. */
export function doneLog(added: readonly string[], gone: readonly string[], reference: string): string {
  const parts: string[] = []
  if (added.length > 0) parts.push(`${reference} now lists the variables it lacked: ${namedPlain(added)}`)
  if (gone.length > 0) parts.push(`the code no longer reads: ${namedPlain(gone)}`)
  return parts.join(' · ')
}

/** One sidebar line per variable, the ones the file gained and the ones nothing reads any more. */
export function doneLines(added: readonly string[], gone: readonly string[]): { text: string; kind: 'ok' }[] {
  const names = [...added.slice(0, MAX_NAMED), ...gone.slice(0, MAX_NAMED).map(n => `${n} (no longer read)`)]
  return names.map(text => ({ text, kind: 'ok' as const }))
}

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(open: readonly Open[], reference: string): string {
  const named = namedPlain(open.map(o => `${o.name} (${o.file})`))
  return `env-sync: ${reference} still lacks ${open.length} env variable(s) the code reads: ${named}. Add them to ${reference} with a placeholder value, or take the reads out.`
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one reference file keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
