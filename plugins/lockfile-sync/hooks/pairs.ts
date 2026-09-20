/** Which commands commit, which manifests pair with which lockfiles, and whether a manifest diff touches dependencies. */

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit` the model runs, not one it only asks about. */
const COMMIT = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+commit\b`)
const NOT_A_COMMIT = /\s(--dry-run|--help|-h)(\s|$)/

export function isCommit(command: string): boolean {
  return COMMIT.test(command) && !NOT_A_COMMIT.test(command)
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

/** The lockfiles each manifest's package manager writes. */
export const LOCKS: Record<string, string[]> = {
  'package.json': ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'],
  'composer.json': ['composer.lock'],
  'Cargo.toml': ['Cargo.lock'],
  'go.mod': ['go.sum'],
  'pyproject.toml': ['poetry.lock', 'uv.lock', 'pdm.lock'],
  Pipfile: ['Pipfile.lock'],
  Gemfile: ['Gemfile.lock'],
  'pubspec.yaml': ['pubspec.lock'],
  'mix.exs': ['mix.lock'],
}

const baseName = (path: string): string => path.split('/').at(-1) ?? path

/** The files a `git show --name-status` lists as added or modified; a deleted file is left out. */
export function changedFiles(nameStatus: string): string[] {
  return nameStatus.split('\n').flatMap(line => {
    const [status = '', ...paths] = line.split('\t')
    return status === '' || status.startsWith('D') ? [] : [paths.at(-1) ?? '']
  }).filter(p => p !== '')
}

export function isManifest(path: string): boolean {
  return baseName(path) in LOCKS
}

/** The lockfile paths a manifest may use, nearest directory first up to the repository root (a workspace keeps one at the root). */
export function lockCandidates(manifest: string): string[] {
  const dirs = manifest.split('/').slice(0, -1)
  const locks = LOCKS[baseName(manifest)] ?? []
  const out: string[] = []
  for (let n = dirs.length; n >= 0; n--) {
    const prefix = dirs.slice(0, n).join('/')
    for (const lock of locks) out.push(prefix === '' ? lock : `${prefix}/${lock}`)
  }
  return out
}

const JSON_DEPS = /^(dependencies|devDependencies|peerDependencies|optionalDependencies|bundledDependencies|overrides|resolutions|require|require-dev|replace|conflict|provide)$/
const TOML_DEPS = /(^|\.)(dependencies|dev-dependencies|build-dependencies|dev-packages|packages|dependency-groups|optional-dependencies|patch(\..+)?|project|group\.[^.]+\.dependencies)$/
const YAML_DEPS = /^(dependencies|dev_dependencies|dependency_overrides)$/

const indentOf = (line: string): number => (/^\s*/.exec(line)?.[0] ?? '').length

/** A JSON object's first line: `"key": {`, or a bare `{` for the root object. */
const JSON_OPEN = /^\s*(?:"([^"]+)"\s*:\s*)?\{\s*$/
const YAML_OPEN = /^\s*([\w-]+):\s*$/

/** The key of the nearest object that encloses `lines[i]` by indent; `''` for the root object. */
function enclosingKey(lines: string[], i: number, opener: RegExp): string | undefined {
  const indent = indentOf(lines[i] ?? '')
  for (let j = i - 1; j >= 0; j--) {
    const m = opener.exec(lines[j] ?? '')
    if (m !== null && indentOf(lines[j] ?? '') < indent) return m[1] ?? ''
  }
  return undefined
}

/** The TOML table `lines[i]` sits in. */
function tomlTable(lines: string[], i: number): string | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(lines[j] ?? '')
    if (m !== null) return m[1]
  }
  return undefined
}

/** Whether a go.mod line is a `require`, `replace` or `exclude` line or sits in such a block. */
function goDependency(lines: string[], i: number): boolean {
  if (/^\s*(require|replace|exclude|retract)\b/.test(lines[i] ?? '')) return true
  for (let j = i - 1; j >= 0; j--) {
    if (/^\s*\)/.test(lines[j] ?? '')) return false
    if (/^\s*(require|replace|exclude)\s*\(/.test(lines[j] ?? '')) return true
  }
  return false
}

// A key or table the hunk does not show counts as a dependency, so a manifest whose section is unknown still gets the note.

function jsonDependency(lines: string[], i: number): boolean {
  const key = enclosingKey(lines, i, JSON_OPEN)
  return key === undefined || JSON_DEPS.test(key)
}

function yamlDependency(lines: string[], i: number): boolean {
  const key = enclosingKey(lines, i, YAML_OPEN)
  return key === undefined || YAML_DEPS.test(key)
}

function tomlDependency(lines: string[], i: number): boolean {
  const table = tomlTable(lines, i)
  return table === undefined || TOML_DEPS.test(table)
}

const gemDependency = (lines: string[], i: number): boolean => /^\s*(gem|source|gemspec|git|path|group|platforms?)\b/.test(lines[i] ?? '')

/** Per manifest, whether its changed line `lines[i]` can change the lockfile; a manifest without an entry always can. */
const DEPENDENCY_LINE: Record<string, (lines: string[], i: number) => boolean> = {
  'package.json': jsonDependency,
  'composer.json': jsonDependency,
  'Cargo.toml': tomlDependency,
  'pyproject.toml': tomlDependency,
  Pipfile: tomlDependency,
  'go.mod': goDependency,
  Gemfile: gemDependency,
  'pubspec.yaml': yamlDependency,
}

function isDependencyLine(manifest: string, lines: string[], i: number): boolean {
  const check = DEPENDENCY_LINE[baseName(manifest)]
  return check === undefined || check(lines, i)
}

/** Whether a `git show --unified=20` diff of one manifest changes a line that can change its lockfile. */
export function touchesDependencies(manifest: string, diff: string): boolean {
  for (const hunk of diff.split(/^@@[^\n]*\n/m).slice(1)) {
    // Each line as it stands after the commit, with removed lines kept in place so their section is known.
    const lines = hunk.split('\n').map(l => l.slice(1))
    const changed = hunk.split('\n').map((l, i) => ((l.startsWith('+') || l.startsWith('-')) && l.slice(1).trim() !== '' ? i : -1)).filter(i => i >= 0)
    if (changed.some(i => isDependencyLine(manifest, lines, i))) return true
  }
  return false
}

/** A manifest the commit changed and the lockfile it left unchanged. */
export type Stale = { manifest: string; lock: string }

function namedPairs(stale: readonly Stale[]): string {
  return stale.map(s => `${s.manifest} but not ${s.lock}`).join(' · ')
}

export function noteText(stale: readonly Stale[]): string {
  return `lockfile-sync: this commit changes ${namedPairs(stale)}. Run the package manager's install so the lockfile matches, and commit it.`
}

/** The transcript line: the pairs alone, without the instruction the model reads. The engine adds the mod name. */
export function logText(stale: readonly Stale[]): string {
  return `this commit changes ${namedPairs(stale)}`
}

/** One sidebar line per pair, so the section reads as a list. */
export function sidebarLines(stale: readonly Stale[]): { text: string; kind: 'warn' }[] {
  return stale.map(s => ({ text: `${s.manifest} but not ${s.lock}`, kind: 'warn' }))
}

/** A sidebar section key: the manifests of this commit, cut to what the sidebar takes. */
export function sectionKey(stale: readonly Stale[]): string {
  return stale.map(s => s.manifest).join('-').replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
