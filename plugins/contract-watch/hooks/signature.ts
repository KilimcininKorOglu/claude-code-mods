/** Which function signatures an edit changes, and the note the model reads about their callers. */

/** A one-line function definition: its name and its parameter text. */
export type Signature = { name: string; params: string }

/** Words that open a statement, not a method, before a parenthesis. */
const NOT_METHODS: ReadonlySet<string> = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'with', 'new', 'await', 'typeof'])

/** One-line definitions, per language; group 1 is the name, group 2 the parameters. */
const PATTERNS: readonly RegExp[] = [
  // Go, with an optional receiver and type parameters.
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\(([^)]*)\)/,
  // JS and TS function declarations; PHP functions and methods.
  /^\s*(?:export\s+)?(?:default\s+)?(?:(?:public|private|protected|static|final|abstract)\s+)*(?:async\s+)?function\s*\*?\s*&?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(([^)]*)\)/,
  // JS and TS arrow functions bound to a name.
  /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:<[^>]*>)?\(([^)]*)\)\s*(?::[^=]+)?=>/,
  // Python.
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/,
  // Rust.
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\(([^)]*)\)/,
  // Java methods, which carry a modifier and a return type.
  /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)+[\w<>[\],.?\s]+?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/,
  // TS and JS class methods: a name, parameters, an optional return type, then the body's brace.
  /^\s*(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(([^)]*)\)\s*(?::\s*[^{=]+)?\{\s*$/,
]

function signatureOf(line: string): Signature | undefined {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(line)
    const name = m?.[1]
    if (name !== undefined && !NOT_METHODS.has(name)) return { name, params: (m?.[2] ?? '').replace(/\s+/g, ' ').trim() }
  }
  return undefined
}

/** The parameters of each function the text defines on one line, by name. */
export function signaturesIn(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const line of text.split('\n')) {
    const s = signatureOf(line)
    if (s !== undefined) found.set(s.name, s.params)
  }
  return found
}

/** The functions both texts define whose parameters differ. */
export function changedSignatures(before: string, after: string): string[] {
  const old = signaturesIn(before)
  return [...signaturesIn(after)].filter(([name, params]) => old.has(name) && old.get(name) !== params).map(([name]) => name)
}

/**
 * One caller `ripwire --edit-check` names. `mismatch` is ripwire's own mark on that caller: every folded
 * definition it sees disagrees with the new arity. Without it the caller only shares the symbol's name,
 * and a call of another type's method of that name reads the same, because the call graph binds by name.
 */
export type Caller = { name: string; at: string; mismatch: boolean }

/** What `ripwire --edit-check` says of one symbol: whether its contract changed, and who calls it. */
export type Check = { sym: string; status: string; paramsWas?: number; paramsNow?: number; incompatible: number; callers: Caller[] }

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

function count(tag: string, name: string): number | undefined {
  const v = attr(tag, name)
  return v === undefined ? undefined : Number(v)
}

/** Reads `ripwire --edit-check` output; undefined when it has no edit-check element. */
export function parseCheck(output: string): Check | undefined {
  const text = output.replace(/<!--[\s\S]*?-->/g, '')
  const head = /<edit-check\b[^>]*>/.exec(text)?.[0]
  if (head === undefined) return undefined
  const callers = [...text.matchAll(/<c\b[^>]*\/>/g)].map(m => ({ name: attr(m[0], 'n') ?? '?', at: attr(m[0], 'p') ?? '?', mismatch: attr(m[0], 'incompatible') === '1' }))
  return { sym: attr(head, 'sym') ?? '?', status: attr(head, 'status') ?? '', paramsWas: count(head, 'params_was'), paramsNow: count(head, 'params_now'), incompatible: count(head, 'incompatible') ?? 0, callers }
}

/** At most this many callers are named; the rest are counted. */
const MAX_CALLERS = 10

function paramsText(c: Check): string {
  if (c.paramsWas === undefined || c.paramsNow === undefined || c.paramsWas === c.paramsNow) return 'changed its parameters'
  return `changed from ${c.paramsWas} to ${c.paramsNow} parameter(s)`
}

function listed(rows: readonly Caller[]): string {
  const named = rows.slice(0, MAX_CALLERS).map(x => `${x.name} (${x.at})`).join(', ')
  return rows.length > MAX_CALLERS ? `${named} and ${rows.length - MAX_CALLERS} more` : named
}

/** The callers ripwire marks as not matching the new arity, and the ones that only share the name. */
function split(c: Check): { bad: Caller[]; same: Caller[] } {
  return { bad: c.callers.filter(x => x.mismatch), same: c.callers.filter(x => !x.mismatch) }
}

/** The caller part of the model's note: the marked callers first, the same-named ones after them. */
function namedCallers(c: Check): string {
  const { bad, same } = split(c)
  if (bad.length === 0) return `check each caller: ${listed(same)}`
  const rest = same.length === 0 ? '' : ` Other callers of that name, which the call graph binds by name and may belong to another type: ${listed(same)}.`
  return `these callers do not match the new arity: ${listed(bad)}.${rest} Check each`
}

/** Whether this check has something to report: a changed contract that something calls. */
export function isReported(c: Check): boolean {
  return c.status === 'contract-change' && c.callers.length > 0
}

/** The note for one changed contract, or undefined when nothing calls it. */
export function noteText(c: Check): string | undefined {
  if (!isReported(c)) return undefined
  return `contract-watch: ${c.sym} ${paramsText(c)} since the last commit; ${namedCallers(c)}.`
}

/**
 * The transcript line for one changed contract: the finding alone, without the instruction the model
 * reads, or undefined when nothing calls it. The engine adds the mod name.
 */
export function logText(c: Check): string | undefined {
  if (!isReported(c)) return undefined
  const { bad, same } = split(c)
  if (bad.length === 0) return `${c.sym} ${paramsText(c)}; callers: ${listed(same)}`
  const rest = same.length === 0 ? '' : `; same name: ${listed(same)}`
  return `${c.sym} ${paramsText(c)}; do not match: ${listed(bad)}${rest}`
}

/** A sidebar line, as the sidebar mod's contract names it. */
type Line = { text: string; kind: 'error' | 'dim' }

function rowsOf(callers: readonly Caller[], kind: 'error' | 'dim'): Line[] {
  const out: Line[] = callers.slice(0, MAX_CALLERS).map(x => ({ text: `${x.name} (${x.at})`, kind }))
  const rest = callers.length - MAX_CALLERS
  if (rest > 0) out.push({ text: `${rest} more`, kind })
  return out
}

/** The change on the first line, then the marked callers in red and the same-named ones faint under them. */
export function sidebarLines(c: Check): Line[] {
  const { bad, same } = split(c)
  const head: Line = { text: `${c.sym} ${paramsText(c)}`, kind: 'error' }
  if (bad.length === 0) return [head, ...rowsOf(same, 'dim')]
  const tail = same.length === 0 ? [] : [{ text: 'same name, may be another type', kind: 'dim' as const }, ...rowsOf(same, 'dim')]
  return [head, ...rowsOf(bad, 'error'), ...tail]
}

/**
 * Whether the gate stops a command for this check. The note names every caller of a changed contract,
 * because a caller on the old arity was measured while `incompatible` read 0; the gate takes the narrower
 * measure, the callers ripwire calls incompatible by fixed-arity evidence, because that count falls again
 * once the model fixes them and a gate that never opens is a gate nobody can pass.
 */
export function isBlocking(c: Check): boolean {
  return c.status === 'contract-change' && c.incompatible > 0
}

/** The finding line of a blocking check: the symbol and how many callers do not match it. */
export function blockingLine(c: Check): string {
  return `${c.sym} ${paramsText(c)}, ${c.incompatible} caller(s) do not match`
}

/**
 * The transcript line of a finding a later check closed. `matched` says which measure closed it: the
 * contract reads the same as the last commit again, or it still differs and no caller carries ripwire's
 * mismatch mark any more. The second text names what was measured, because a call graph that binds by
 * name cannot prove every caller right.
 */
export function doneLog(sym: string, matched: boolean): string {
  if (matched) return `every caller matches ${sym} again`
  return `no caller of ${sym} carries the mismatch mark any more`
}

/** The sidebar lines of a closed finding. */
export function doneLines(sym: string, matched: boolean): { text: string; kind: 'ok' }[] {
  return [{ text: doneLog(sym, matched), kind: 'ok' }]
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the gate stops while a finding is open. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !ASKING.test(command)
}

/** Whether the command is a `git commit`, the one guarded command whose own files can be measured. */
export function isCommit(command: string): boolean {
  return GUARDED.exec(command)?.[2] === 'commit'
}

/**
 * Whether the index alone says what this commit holds. A `-a` or `-am` commit stages the tracked files
 * as it runs, and a pathspec after `--` commits paths the index does not hold, so neither is narrowed.
 */
export function isNarrowable(command: string): boolean {
  const words = command.split(/\s+/)
  return !words.includes('--') && !words.some(w => w === '--all' || /^-[A-Za-z]*a/.test(w))
}

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/contract-watch mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** The deny text both the model and the person read: which callers do not match, and the one way out. */
export function denyText(lines: readonly string[]): string {
  return `stopped: ${lines.length} changed signature(s) leave a caller behind: ${lines.join(' · ')}. Bring each caller to the new signature, then run the command again; there is no way around this gate.`
}

/**
 * The note the model reads at the next prompt while a finding stands, so a finding it did not close
 * reaches it again instead of standing in the pane alone. The person reads the pane and needs no line.
 */
export function openNote(lines: readonly string[]): string {
  return `contract-watch: ${lines.length} changed signature(s) still leave a caller behind: ${lines.join(' · ')}. Bring each caller to the new signature, or take the signature change back.`
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one symbol keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
