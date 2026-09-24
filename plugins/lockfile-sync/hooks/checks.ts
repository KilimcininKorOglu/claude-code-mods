/**
 * Which package manager command says whether a lockfile still fits its manifest, and how its answer reads.
 * Every command here was measured to write no file into the repository: a check that installs, links or
 * rewrites the lockfile is not listed, and its lockfile stays with the manifest's diff alone.
 */

/** What a package manager says of a lockfile: it fits, it is behind, or the answer proves nothing. */
export type Verdict = 'in-sync' | 'behind' | 'unknown'

/** A finished command, as `$.process.run` answers it. */
export type Ran = { exitCode: number; stdout: string; stderr: string }

/** How to ask one package manager: the tool's name, its argv, its environment, and how its answer reads. */
export type LockCheck = {
  tool: string
  argv: (manifestPath: string) => string[]
  /** Variables for the run; `tmp` is the mod's own temporary directory. */
  env?: (tmp: string) => Record<string, string>
  judge: (ran: Ran, lockText: string) => Verdict
}

const outputOf = (ran: Ran): string => `${ran.stdout}\n${ran.stderr}`

/** A check that passes with exit 0 and says `behind` in its failure text; any other failure proves nothing. */
function failsWith(pattern: RegExp): (ran: Ran) => Verdict {
  return ran => {
    if (ran.exitCode === 0) return 'in-sync'
    return pattern.test(outputOf(ran)) ? 'behind' : 'unknown'
  }
}

/** `go mod tidy -diff` fails for an untidy go.mod too; only a go.sum hunk means the lockfile is behind. */
function judgeGo(ran: Ran): Verdict {
  if (ran.exitCode === 0) return 'in-sync'
  if (ran.stdout.includes('--- current/go.sum')) return 'behind'
  return ran.stdout.includes('--- current/go.mod') ? 'in-sync' : 'unknown'
}

/** A `yarn check` error that speaks of node_modules, not of the lockfile. */
const YARN_INSTALL_ERROR = /^error ("[^"]+" not installed|Found \d+ errors?\.)$/

/** Yarn v1 also reports every package missing from node_modules; only a missing pattern is the lockfile's. */
function judgeYarn(ran: Ran): Verdict {
  const output = outputOf(ran)
  if (output.includes('Lockfile does not contain pattern')) return 'behind'
  if (ran.exitCode === 0) return 'in-sync'
  const errors = output.split('\n').map(l => l.trim()).filter(l => l.startsWith('error '))
  return errors.length > 0 && errors.every(l => YARN_INSTALL_ERROR.test(l)) ? 'in-sync' : 'unknown'
}

/** Gemfile.lock blocks that follow the machine or the Bundler version rather than the Gemfile. */
const GEM_LOCAL = /^(PLATFORMS|CHECKSUMS|BUNDLED WITH|RUBY VERSION)$/

/** The lockfile's blocks that the Gemfile decides, in order. */
export function gemCore(text: string): string {
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(b => b.trim()).filter(b => b !== '' && !GEM_LOCAL.test(b.split('\n')[0] ?? '')).join('\n\n')
}

/** `bundle lock --print` prints the lockfile the Gemfile asks for; a cut or failed print proves nothing. */
function judgeBundle(ran: Ran, lockText: string): Verdict {
  if (ran.exitCode !== 0 || !ran.stdout.includes('\nDEPENDENCIES\n')) return 'unknown'
  return gemCore(ran.stdout) === gemCore(lockText) ? 'in-sync' : 'behind'
}

const NPM: LockCheck = { tool: 'npm', argv: () => ['npm', 'ci', '--dry-run', '--ignore-scripts'], judge: failsWith(/are in sync/) }
const BUN: LockCheck = { tool: 'bun', argv: () => ['bun', 'install', '--frozen-lockfile', '--dry-run', '--ignore-scripts'], judge: failsWith(/lockfile had changes/) }

/** The check per lockfile name. A lockfile without an entry is judged by the manifest's diff alone. */
const LOCK_CHECK: Record<string, LockCheck> = {
  'Cargo.lock': { tool: 'cargo', argv: m => ['cargo', 'metadata', '--locked', '--format-version', '1', '--manifest-path', m], judge: failsWith(/cannot update the lock file/) },
  'package-lock.json': NPM,
  'pnpm-lock.yaml': { tool: 'pnpm', argv: () => ['pnpm', 'install', '--frozen-lockfile', '--lockfile-only', '--ignore-pnpmfile', '--ignore-scripts'], judge: failsWith(/don't match specifiers/) },
  'bun.lock': BUN,
  'bun.lockb': BUN,
  'yarn.lock': { tool: 'yarn', argv: () => ['yarn', 'check'], judge: judgeYarn },
  'composer.lock': { tool: 'composer', argv: () => ['composer', 'validate', '--no-check-all', '--no-check-publish', '--check-lock', '--no-plugins'], judge: failsWith(/lock file is not up to date/) },
  'go.sum': { tool: 'go', argv: () => ['go', 'mod', 'tidy', '-diff'], judge: judgeGo },
  'uv.lock': { tool: 'uv', argv: () => ['uv', 'lock', '--check'], judge: failsWith(/needs to be updated/) },
  'poetry.lock': { tool: 'poetry', argv: () => ['poetry', 'check', '--lock'], judge: failsWith(/changed significantly/) },
  'pdm.lock': { tool: 'pdm', argv: () => ['pdm', 'lock', '--check'], judge: failsWith(/satisfy the project requirements/) },
  'Pipfile.lock': { tool: 'pipenv', argv: () => ['pipenv', 'verify'], judge: failsWith(/out-of-date/) },
  'Gemfile.lock': { tool: 'bundle', argv: () => ['bundle', 'lock', '--print'], judge: judgeBundle },
  'pubspec.lock': { tool: 'dart', argv: () => ['dart', 'pub', 'get', '--enforce-lockfile', '--dry-run'], judge: failsWith(/Unable to satisfy/) },
  // Without its own deps path, `mix deps.get` fetches into the project's deps/.
  'mix.lock': { tool: 'mix', argv: () => ['mix', 'deps.get', '--check-locked'], env: tmp => ({ MIX_DEPS_PATH: `${tmp}/mix-deps` }), judge: failsWith(/mix\.lock is out of date/) },
}

/** A Yarn v1 lockfile's first comment; Yarn 2 and later write none, and their check links node_modules. */
const YARN_V1 = /^# yarn lockfile v1/m

/** The check for a lockfile, or undefined when none reads it without writing into the repository. */
export function checkFor(lock: string, lockText: string): LockCheck | undefined {
  const name = lock.split('/').at(-1) ?? lock
  if (name === 'yarn.lock' && !YARN_V1.test(lockText)) return undefined
  return LOCK_CHECK[name]
}

/** The directory a lockfile sits in, relative to the repository root; `''` for the root. */
export function lockDir(lock: string): string {
  return lock.split('/').slice(0, -1).join('/')
}
