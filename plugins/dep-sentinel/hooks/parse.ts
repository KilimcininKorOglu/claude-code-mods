/** The packages a shell command installs, read without a shell. */

export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'crates.io' | 'Packagist'

/** One package to install: its name as the registry knows it, and the version asked for when one is. */
export type Install = { ecosystem: Ecosystem; name: string; version?: string; exact: boolean }

/** What a command installs; `skipped` when it carries the DEP_SENTINEL_SKIP=1 prefix. */
export type Plan = { skipped: boolean; installs: Install[] }

/** The shell words of a command, quotes removed; a separator (`&&`, `;`, `|`, a newline) is its own word. */
export function words(command: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(&&|\|\||[;|\n])|([^\s"';|&]+)/g
  for (const m of command.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

const SEPARATOR = new Set(['&&', '||', ';', '|', '\n'])

/** The simple commands of a command line, each without its leading `VAR=value` words. */
export function commands(command: string): { env: string[]; argv: string[] }[] {
  const out: { env: string[]; argv: string[] }[] = [{ env: [], argv: [] }]
  for (const w of words(command)) {
    const cur = out[out.length - 1]
    if (cur === undefined) break
    if (SEPARATOR.has(w)) out.push({ env: [], argv: [] })
    else if (cur.argv.length === 0 && /^[A-Za-z_]\w*=/.test(w)) cur.env.push(w)
    else cur.argv.push(w)
  }
  return out.filter(c => c.argv.length > 0)
}

const EXACT = /^v?\d+\.\d+\.\d+([-+][\w.]+)?$/

/** Options whose next word is their value, so that word is not read as a package. */
const VALUE_FLAGS = new Set(['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-i', '--index-url', '--extra-index-url', '--registry', '--prefix', '-C', '--dir', '--filter', '-w', '--workspace', '--features', '-F', '--package', '-p', '--target', '--python', '--group', '-G', '--optional'])

/** The words after `from` that are packages: options and the values they take are left out. */
function operands(argv: readonly string[], from: number): string[] {
  const out: string[] = []
  for (let i = from; i < argv.length; i++) {
    const w = argv[i] ?? ''
    if (VALUE_FLAGS.has(w)) i++
    else if (!w.startsWith('-')) out.push(w)
  }
  return out
}

/** A requirement file or an editable install is not checked, so a command with one is read as having none. */
const hasFileInstall = (argv: readonly string[]): boolean => argv.some(w => ['-r', '--requirement', '-e', '--editable'].includes(w))

const isLocal = (spec: string): boolean => /^(\.|\/|~|file:|git[+:]|https?:|link:|workspace:|npm:)/.test(spec) || /\.(tgz|tar\.gz|whl|zip)$/.test(spec)

export function npmSpec(spec: string): Install | undefined {
  if (isLocal(spec)) return undefined
  const m = /^((?:@[\w.-]+\/)?[\w.-]+)(?:@(.+))?$/.exec(spec)
  if (m === null) return undefined
  const version = m[2]?.replace(/^=/, '')
  return { ecosystem: 'npm', name: (m[1] ?? '').toLowerCase(), ...(version === undefined ? {} : { version }), exact: version !== undefined && EXACT.test(version) }
}

/** A PyPI name in its normalized form (PEP 503). */
export const pypiName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-')

export function pySpec(spec: string): Install | undefined {
  if (isLocal(spec) || spec.includes('/')) return undefined
  const m = /^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(==|===|>=|<=|~=|!=|>|<)?\s*([^;,\s]*)/.exec(spec)
  if (m === null) return undefined
  const exact = (m[2] === '==' || m[2] === '===') && /^\d+(\.\d+)*$/.test(m[3] ?? '')
  return { ecosystem: 'PyPI', name: pypiName(m[1] ?? ''), ...(exact ? { version: m[3] } : {}), exact }
}

export function goSpec(spec: string): Install | undefined {
  const [path = '', version] = spec.split('@')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(path) || path.includes('...')) return undefined
  const exact = version !== undefined && EXACT.test(version)
  return { ecosystem: 'Go', name: path, ...(exact ? { version } : {}), exact }
}

export function crateSpec(spec: string): Install | undefined {
  const m = /^([A-Za-z0-9_-]+)(?:@(=?)(.+))?$/.exec(spec)
  if (m === null) return undefined
  const exact = m[2] === '=' && EXACT.test(m[3] ?? '')
  return { ecosystem: 'crates.io', name: (m[1] ?? '').toLowerCase(), ...(m[3] === undefined ? {} : { version: m[3] }), exact }
}

export function composerSpec(spec: string, next?: string): Install | undefined {
  const [name = '', inline] = spec.split(':')
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) return undefined
  const version = inline ?? (next !== undefined && /^[v\d^~*<>=]/.test(next) ? next : undefined)
  return { ecosystem: 'Packagist', name: name.toLowerCase(), ...(version === undefined ? {} : { version }), exact: version !== undefined && EXACT.test(version) }
}

type Reader = { at: (argv: readonly string[]) => number | undefined; spec: (spec: string, next?: string) => Install | undefined }

const after = (argv: readonly string[], lead: readonly string[][], verbs: readonly string[]): number | undefined => {
  const hit = lead.find(l => l.every((w, i) => argv[i] === w))
  if (hit === undefined) return undefined
  return verbs.includes(argv[hit.length] ?? '') ? hit.length + 1 : undefined
}

/** Where each installer's packages start, and how one of its package words reads. */
const READERS: Reader[] = [
  { at: a => after(a, [['npm'], ['pnpm'], ['bun']], ['i', 'install', 'add', 'in']) ?? after(a, [['yarn']], ['add']), spec: npmSpec },
  { at: a => after(a, [['pip'], ['pip3'], ['python', '-m', 'pip'], ['python3', '-m', 'pip'], ['uv', 'pip']], ['install']) ?? after(a, [['uv'], ['poetry']], ['add']), spec: pySpec },
  { at: a => after(a, [['go']], ['get', 'install']), spec: goSpec },
  { at: a => after(a, [['cargo']], ['add']), spec: crateSpec },
  { at: a => after(a, [['composer']], ['require']), spec: composerSpec },
]

function installsOf(argv: readonly string[]): Install[] {
  if (hasFileInstall(argv)) return []
  for (const reader of READERS) {
    const from = reader.at(argv)
    if (from === undefined) continue
    const specs = operands(argv, from)
    return specs.map((s, i) => reader.spec(s, specs[i + 1])).filter((p): p is Install => p !== undefined)
  }
  return []
}

/** The packages a command installs, at most `limit`, and whether it carries the skip prefix. */
export function planOf(command: string, limit = 10): Plan {
  const cmds = commands(command)
  const skipped = cmds.some(c => c.env.includes('DEP_SENTINEL_SKIP=1'))
  const installs = cmds.flatMap(c => installsOf(c.argv))
  const unique = installs.filter((p, i) => installs.findIndex(q => q.ecosystem === p.ecosystem && q.name === p.name) === i)
  return { skipped, installs: unique.slice(0, limit) }
}
