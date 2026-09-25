/**
 * Names the command a filter answers for: `npx tsc`, `python3 -m pytest`, `./gradlew`, `git -C dir
 * status` and `/usr/bin/git status` all read as the tool and subcommand the filter tables are keyed by.
 */

/** A classified command: the tool, its subcommand when the tool has them, and the arguments after. */
export type Classified = {
  tool: string
  sub: string
  args: string[]
  /** The index, in the words handed in, of the last word of the name (`test` in `go test`). */
  nameEnd: number
}

/** Tools whose first argument is a subcommand the filters tell apart. */
const SUBCOMMAND_TOOLS = new Set([
  'git', 'yadm', 'gh', 'glab', 'gt', 'cargo', 'go', 'npm', 'pnpm', 'bun', 'deno', 'docker', 'kubectl', 'oc',
  'aws', 'helm', 'terraform', 'tofu', 'pulumi', 'pip', 'pip3', 'uv', 'poetry', 'ruff', 'sqlfluff', 'dotnet',
  'mvn', 'mvnd', 'gradle', 'gradlew', 'sbt', 'bundle', 'rake', 'rails', 'artisan', 'golangci-lint', 'next',
  'prisma', 'playwright', 'brew', 'composer', 'mix', 'swift', 'systemctl', 'gcloud', 'pio', 'pre-commit',
  'trunk', 'quarto', 'shopify', 'liquibase', 'ansible-playbook', 'fail2ban-client', 'yarn', 'phpstan',
])

/** Runners that start another tool: the words they take before it. */
const RUNNERS: Record<string, (words: string[]) => number> = {
  npx: w => 1 + optionCount(w, 1),
  bunx: w => 1 + optionCount(w, 1),
  pnpx: w => 1 + optionCount(w, 1),
  pnpm: w => (['exec', 'dlx'].includes(w[1] ?? '') ? 2 : 0),
  npm: w => (['exec', 'x'].includes(w[1] ?? '') ? 2 + optionCount(w, 2) : 0),
  uv: w => (w[1] === 'run' ? 2 + optionCount(w, 2) : 0),
  poetry: w => (w[1] === 'run' ? 2 : 0),
  pipenv: w => (w[1] === 'run' ? 2 : 0),
  bundle: w => (w[1] === 'exec' ? 2 : 0),
  python: w => (w[1] === '-m' ? 2 : 0),
  python3: w => (w[1] === '-m' ? 2 : 0),
  php: w => (w[1] === 'artisan' ? 1 : 0),
}

/** Git's options before the subcommand; the ones in `TAKES_VALUE` take the next word as well. */
const GIT_TAKES_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** A file name with its directory and a Windows or wrapper suffix dropped: `./gradlew.bat` is `gradlew`. */
export function baseName(word: string): string {
  const name = word.split(/[\\/]/).pop() ?? word
  return name.replace(/\.(exe|bat|cmd)$/i, '').replace(/^mvnw$/, 'mvn')
}

function optionCount(words: string[], from: number): number {
  let n = 0
  while (from + n < words.length && (words[from + n] ?? '').startsWith('-')) n += 1
  return n
}

/** The index of the tool's own name after every runner: `npx --yes tsc` is `tsc` at 2. */
function toolIndex(words: string[]): number {
  let at = 0
  for (let guard = 0; guard < 4; guard += 1) {
    const runner = RUNNERS[baseName(words[at] ?? '')]
    const n = runner === undefined ? 0 : runner(words.slice(at))
    if (n === 0 || at + n >= words.length) return at
    at += n
  }
  return at
}

/** The index of git's subcommand after its global options. */
function gitSubIndex(words: string[], at: number): number {
  let i = at + 1
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    const word = words[i] ?? ''
    i += GIT_TAKES_VALUE.has(word) ? 2 : 1
  }
  return i
}

/** The index of the subcommand: the first word after the tool that is not an option. */
function subIndex(tool: string, words: string[], at: number): number {
  if (tool === 'git' || tool === 'yadm') return gitSubIndex(words, at)
  let i = at + 1
  while (i < words.length && (words[i] ?? '').startsWith('-')) i += 1
  return i
}

/** Reads the tool and subcommand of a command's words, or undefined for no words. */
export function classify(words: string[]): Classified | undefined {
  if (words.length === 0) return undefined
  const at = toolIndex(words)
  const tool = baseName(words[at] ?? '')
  if (!SUBCOMMAND_TOOLS.has(tool)) return { tool, sub: '', args: words.slice(at + 1), nameEnd: at }
  const s = subIndex(tool, words, at)
  if (s >= words.length) return { tool, sub: '', args: words.slice(at + 1), nameEnd: at }
  return { tool, sub: words[s] ?? '', args: [...words.slice(at + 1, s), ...words.slice(s + 1)], nameEnd: s }
}
