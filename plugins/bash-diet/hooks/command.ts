import { asksVerbose } from './filters/common.ts'
import { hidesStdout, isAssignment, parse, type Segment, type Stage, type Token } from './shell.ts'

/** The variable that leaves one call's output as it is: `BASH_DIET_RAW=1 git diff`. */
export const RAW_VARIABLE = 'BASH_DIET_RAW'

/**
 * The command whose output the model reads, as far as a filter needs it: its words after every
 * variable and wrapper (`timeout 60`, `nice`, `command`), and the token each word came from, so a flag
 * can be put into the original text at the right place.
 */
export type Target = {
  words: string[]
  tokens: Token[]
  /** False when a flag must not be added: a pipeline, a chain, a redirect, `sudo`, or an opaque part. */
  canAddFlags: boolean
}

/** What the reading found: the command to filter, or why there is none. */
export type Reading =
  | { kind: 'raw' }
  | { kind: 'opaque' }
  | { kind: 'mixed' }
  | { kind: 'target'; target: Target }

/** Commands that print nothing worth a filter; a chain around one command is still that command's output. */
const QUIET = new Set([
  'cd', 'pushd', 'popd', 'export', 'unset', 'set', 'source', '.', 'mkdir', 'rm', 'rmdir', 'mv', 'cp', 'ln',
  'chmod', 'chown', 'touch', 'true', 'false', ':', 'sleep', 'wait', 'trap', 'alias', 'umask', 'shopt',
])

/** Wrappers that take no argument of their own. */
const PLAIN_WRAPPERS = new Set(['command', 'builtin', 'exec', 'noglob', 'nocorrect', 'nohup', 'time', 'sudo'])

/** Stages after a producer that only cut its output, so the producer's filter still reads it. */
const CUTTERS = new Set(['cat', 'head', 'tail'])

/** Where a flag may follow `sudo` no more than it may follow a pipe. */
const NO_FLAG_WRAPPERS = new Set(['sudo'])

const valueOf = (words: Token[], name: string): string | undefined =>
  words.find(w => isAssignment(w.text) && w.text.startsWith(`${name}=`))?.text.slice(name.length + 1)

/** Whether any stage sets the raw variable to a value other than empty or `0`. */
function asksRaw(segments: Segment[]): boolean {
  return segments.some(g => g.stages.some(st => {
    const v = valueOf(st.words, RAW_VARIABLE)
    return v !== undefined && v !== '' && v !== '0'
  }))
}

/**
 * How many words `timeout`, `nice` or `env` take before the command they wrap. `env` wraps only when a
 * command follows its options and variables; alone it is the command, and it prints the environment.
 */
function wrapperLength(words: Token[], at: number): number {
  const name = words[at]?.text ?? ''
  if (PLAIN_WRAPPERS.has(name)) return 1
  if (name === 'env') {
    const n = optionsLength(words, at + 1, /^-/) + 1
    return words.slice(at + n).some(w => !isAssignment(w.text)) ? n : 0
  }
  if (name === 'nice') return optionsLength(words, at + 1, /^-(n)?\d*$|^--adjustment=/) + 1
  if (name === 'timeout') return optionsLength(words, at + 1, /^-/) + 2
  return 0
}

/** The words from `from` that match `option`; `-n 5` and `-s KILL` take the word after them too. */
function optionsLength(words: Token[], from: number, option: RegExp): number {
  let i = from
  while (i < words.length && option.test(words[i]?.text ?? '')) i += /^-[nsk]$/.test(words[i]?.text ?? '') ? 2 : 1
  return i - from
}

/** The stage's words after its variables and wrappers, and whether a wrapper forbids a flag. */
export function peel(words: Token[]): { words: Token[]; noFlags: boolean } {
  let at = 0
  let noFlags = false
  for (let guard = 0; guard < 16 && at < words.length; guard += 1) {
    const text = words[at]?.text ?? ''
    if (isAssignment(text)) { at += 1; continue }
    const n = wrapperLength(words, at)
    if (n === 0) break
    noFlags ||= NO_FLAG_WRAPPERS.has(text)
    at += n
  }
  return { words: words.slice(at), noFlags }
}

const nameOf = (st: Stage): string => (peel(st.words).words[0]?.text ?? '').split('/').pop() ?? ''

/** A `tail` that keeps following a file never ends; its output is not a producer's. */
const isCutter = (st: Stage): boolean =>
  CUTTERS.has(nameOf(st)) && !st.words.some(w => /^-[a-zA-Z]*[fF]/.test(w.text) || w.text === '--follow')

/**
 * The stage whose output a filter reads: the only one, a final `grep` or `rg` (its matches are what
 * the model reads), or a producer followed only by `cat`, `head` or `tail`.
 */
function stageOf(g: Segment): { stage: Stage; alone: boolean } | undefined {
  const [first, ...rest] = g.stages
  if (first === undefined) return undefined
  if (rest.length === 0) return { stage: first, alone: true }
  const last = rest[rest.length - 1] as Stage
  if (['grep', 'rg'].includes(nameOf(last))) return { stage: last, alone: false }
  return rest.every(isCutter) ? { stage: first, alone: false } : undefined
}

/** Quiet commands that print one line per path with `-v`; with it they are the output. */
const VERBOSE_WHEN_ASKED = new Set(['rm', 'mv', 'cp', 'ln'])

/** A quiet command, unless it is one of `VERBOSE_WHEN_ASKED` given `-v` (also in `-rv`) or `--verbose`. */
function isQuiet(st: Stage): boolean {
  const name = nameOf(st)
  if (!QUIET.has(name)) return false
  return !VERBOSE_WHEN_ASKED.has(name) || !asksVerbose(st.words.map(w => w.text))
}

/** The segments that print something: a chain of `cd x && cargo test` is `cargo test`'s output. */
const loud = (segments: Segment[]): Segment[] =>
  segments.filter(g => g.background || !g.stages.every(isQuiet))

/** Reads a command: raw, opaque, a chain of several commands, or the one command to filter. */
export function read(command: string): Reading {
  const { segments, opaque } = parse(command)
  if (asksRaw(segments)) return { kind: 'raw' }
  if (opaque) return { kind: 'opaque' }
  const printing = loud(segments)
  const only = printing.length === 1 ? printing[0] : undefined
  if (only === undefined || only.background) return { kind: 'mixed' }
  return readSegment(only, segments.length === 1)
}

/** Reads the one segment that prints: its stage, and whether a flag may be added to it. */
function readSegment(only: Segment, single: boolean): Reading {
  const picked = stageOf(only)
  if (picked === undefined) return { kind: 'mixed' }
  if (picked.stage.redirects.some(hidesStdout)) return { kind: 'opaque' }
  const { words, noFlags } = peel(picked.stage.words)
  if (words.length === 0) return { kind: 'mixed' }
  const canAddFlags = !noFlags && picked.alone && single && picked.stage.redirects.length === 0
  return { kind: 'target', target: { words: words.map(w => w.text), tokens: words, canAddFlags } }
}

/**
 * The command with flags put right after the word at `after` (the subcommand), where they cannot land
 * behind a `--` or a pathspec. Every flag is one plain word, so it needs no quoting.
 */
export function withFlags(command: string, target: Target, after: number, flags: string[]): string {
  const token = target.tokens[after]
  if (token === undefined || flags.length === 0) return command
  return `${command.slice(0, token.end)} ${flags.join(' ')}${command.slice(token.end)}`
}
