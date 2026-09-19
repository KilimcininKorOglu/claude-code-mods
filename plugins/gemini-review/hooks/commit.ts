/**
 * Reads a Bash command: whether it runs `git commit`, in which directory,
 * what it stages on the way, and the git commands that show that change.
 */

/** What a commit in a command will record, as far as the command says. */
export type CommitPlan = {
  /** A `cd <dir>` before the commit or `git -C <dir>`; relative to the shell's directory. */
  cwd?: string
  /** `GEMINI_REVIEW_SKIP=1` in front of the commit. */
  skip: boolean
  /** Every tracked change: `commit -a`, `add -u`, `add -A`. */
  tracked: boolean
  /** Every untracked file: `add -A`. */
  untracked: boolean
  /** Paths `git add` names before the commit. */
  paths: string[]
  /** The commit's own pathspec: git then records these paths from the working tree and nothing else. */
  only: string[]
}

export const SKIP_VARIABLE = 'GEMINI_REVIEW_SKIP'

/** Drops the body and the end line of every heredoc, so text inside a commit message is not read as a command. */
export function stripHeredocs(text: string): string {
  const out: string[] = []
  let end: string | undefined
  for (const line of text.split('\n')) {
    if (end !== undefined) {
      if (line.trim() === end) end = undefined
      continue
    }
    out.push(line)
    end = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line)?.[2]
  }
  return out.join('\n')
}

type Scan = { segments: string[][]; tokens: string[]; token: string; started: boolean; quote: string | undefined }

function endToken(s: Scan): void {
  if (s.started) s.tokens.push(s.token)
  s.token = ''
  s.started = false
}

function endSegment(s: Scan): void {
  endToken(s)
  if (s.tokens.length > 0) s.segments.push(s.tokens)
  s.tokens = []
}

/** One character inside quotes; returns how many characters it used. */
function quoted(s: Scan, text: string, i: number): number {
  const c = text[i] ?? ''
  if (c === s.quote) s.quote = undefined
  else if (c === '\\' && s.quote === '"' && i + 1 < text.length) {
    s.token += text[i + 1]
    return 2
  } else s.token += c
  return 1
}

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')'])

/** One character outside quotes; returns how many characters it used. */
function unquoted(s: Scan, text: string, i: number): number {
  const c = text[i] ?? ''
  if (SEPARATORS.has(c)) endSegment(s)
  else if (c === ' ' || c === '\t') endToken(s)
  else if (c === '"' || c === "'") {
    s.quote = c
    s.started = true
  } else if (c === '\\' && i + 1 < text.length) {
    s.token += text[i + 1]
    s.started = true
    return 2
  } else {
    s.token += c
    s.started = true
  }
  return 1
}

/** A redirection such as `>out`, `2>`, `<in`; with a bare operator the target is the next word. */
const REDIRECT = /^\d*[<>]/

function withoutRedirections(words: readonly string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? ''
    if (!REDIRECT.test(word)) kept.push(word)
    else if (/^\d*[<>]+$/.test(word)) i++
  }
  return kept
}

/** The simple commands of a command line, each as its words with the quotes and redirections removed. */
export function splitCommand(text: string): string[][] {
  const s: Scan = { segments: [], tokens: [], token: '', started: false, quote: undefined }
  const source = stripHeredocs(text)
  for (let i = 0; i < source.length; ) i += s.quote === undefined ? unquoted(s, source, i) : quoted(s, source, i)
  endSegment(s)
  return s.segments.map(withoutRedirections).filter(words => words.length > 0)
}

type Git = { env: string[]; dir?: string; sub: string; args: string[] }

/** The leading variable assignments (`NAME=value`) of a simple command. */
function assignments(words: readonly string[]): string[] {
  const env: string[] = []
  while (/^[A-Za-z_]\w*=/.test(words[env.length] ?? '')) env.push(words[env.length] ?? '')
  return env
}

/** git's own options before the subcommand, from `start`: the `-C` directory and where the subcommand is. */
function gitOptions(words: readonly string[], start: number): { dir?: string; at: number } {
  let i = start
  let dir: string | undefined
  while ((words[i] ?? '').startsWith('-')) {
    const option = words[i++]
    if (option === '-C') dir = words[i++]
    else if (option === '-c') i++
  }
  return { ...(dir === undefined ? {} : { dir }), at: i }
}

/** A `git` call with its leading variable assignments, its `-C` directory, subcommand and arguments. */
function gitCall(words: readonly string[]): Git | undefined {
  const env = assignments(words)
  if (words[env.length] !== 'git') return undefined
  const { dir, at } = gitOptions(words, env.length + 1)
  const sub = words[at]
  return sub === undefined ? undefined : { env, ...(dir === undefined ? {} : { dir }), sub, args: words.slice(at + 1) }
}

/** Options of `git commit` whose value is the next word. */
const COMMIT_VALUES = new Set(['-m', '-F', '-C', '-c', '-t', '--message', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--cleanup'])

/** Commit options after which nothing is recorded. */
const NO_RECORD = new Set(['--help', '-h', '--dry-run'])

type Staged = { tracked: boolean; untracked: boolean; paths: string[]; only: string[] }

/** One option word of `git commit`; returns how many words it used. */
function commitOption(word: string, next: string | undefined, into: Staged): number {
  if (word === '--all') into.tracked = true
  if (COMMIT_VALUES.has(word)) return next === undefined ? 1 : 2
  if (/^-[a-zA-Z]+$/.test(word)) {
    if (word.includes('a')) into.tracked = true
    if (/[mFCct]$/.test(word)) return 2
  }
  return 1
}

/** What `git commit <args>` records beyond the index; undefined when it records nothing. */
function commitArgs(args: readonly string[], into: Staged): boolean {
  for (let i = 0; i < args.length; ) {
    const word = args[i] ?? ''
    if (NO_RECORD.has(word)) return false
    if (word === '--') {
      into.only.push(...args.slice(i + 1))
      break
    }
    if (word.startsWith('-')) i += commitOption(word, args[i + 1], into)
    else {
      into.only.push(word)
      i++
    }
  }
  return true
}

/** What `git add <args>` stages. */
function addArgs(args: readonly string[], into: Staged): void {
  for (const word of args) {
    if (word === '-A' || word === '--all') {
      into.tracked = true
      into.untracked = true
    } else if (word === '-u' || word === '--update') into.tracked = true
    else if (!word.startsWith('-')) into.paths.push(word)
  }
}

/** The plan for a `git commit` call, given what came before it; undefined when it records nothing. */
function commitPlan(git: Git, staged: Staged, cwd: string | undefined): CommitPlan | undefined {
  if (!commitArgs(git.args, staged)) return undefined
  const dir = git.dir ?? cwd
  return { ...staged, skip: git.env.includes(`${SKIP_VARIABLE}=1`), ...(dir === undefined ? {} : { cwd: dir }) }
}

/** The first `git commit` of a command and what it will record, or undefined when the command commits nothing. */
export function findCommit(command: string): CommitPlan | undefined {
  const staged: Staged = { tracked: false, untracked: false, paths: [], only: [] }
  let cwd: string | undefined
  for (const words of splitCommand(command)) {
    if (words[0] === 'cd' && words.length === 2) cwd = words[1]
    const git = gitCall(words)
    if (git?.sub === 'add') addArgs(git.args, staged)
    if (git?.sub === 'commit') return commitPlan(git, staged, cwd)
  }
  return undefined
}

const DIFF = ['git', 'diff', '--no-color', '--no-ext-diff']

/**
 * The diffs of tracked files the commit records. A path the command stages
 * is read from the working tree, never from the index, because the index
 * still holds its older content until `git add` runs. Without a HEAD, the
 * working tree is read as a diff over the index.
 */
function trackedDiffs(plan: CommitPlan, hasHead: boolean): string[][] {
  const cached = [...DIFF, '--cached']
  // `git diff HEAD -- p` holds the index too, so it replaces `--cached -- p`.
  const tree = (paths: readonly string[]) => (hasHead ? [[...DIFF, 'HEAD', '--', ...paths]] : [[...cached, '--', ...paths], [...DIFF, '--', ...paths]])
  if (plan.only.length > 0) return tree(plan.only)
  if (plan.tracked) return tree([':/'])
  if (plan.paths.length === 0) return [cached]
  if (!hasHead) return [cached, [...DIFF, '--', ...plan.paths]]
  return [[...cached, '--', ':/', ...plan.paths.map(p => `:(exclude)${p}`)], ...tree(plan.paths)]
}

/** The git commands whose output is the change the commit records, and the listing of its new files. */
export function diffCommands(plan: CommitPlan, hasHead: boolean): { diffs: string[][]; untracked?: string[] } {
  const diffs = trackedDiffs(plan, hasHead)
  const listing = ['git', 'ls-files', '--others', '--exclude-standard']
  if (plan.untracked) return { diffs, untracked: listing }
  return plan.paths.length > 0 ? { diffs, untracked: [...listing, '--', ...plan.paths] } : { diffs }
}

/** The diff of one untracked file against nothing. */
export function newFileDiff(path: string): string[] {
  return [...DIFF, '--no-index', '--', '/dev/null', path]
}

/** How many files a diff touches. */
export function fileCount(diff: string): number {
  return diff.split('\n').filter(line => line.startsWith('diff --git ')).length
}
