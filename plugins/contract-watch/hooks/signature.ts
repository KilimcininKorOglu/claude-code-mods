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

/** What `ripwire --edit-check` says of one symbol: whether its contract changed, and who calls it. */
export type Check = { sym: string; status: string; paramsWas?: number; paramsNow?: number; incompatible: number; callers: { name: string; at: string }[] }

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
  const callers = [...text.matchAll(/<c\b[^>]*\/>/g)].map(m => ({ name: attr(m[0], 'n') ?? '?', at: attr(m[0], 'p') ?? '?' }))
  return { sym: attr(head, 'sym') ?? '?', status: attr(head, 'status') ?? '', paramsWas: count(head, 'params_was'), paramsNow: count(head, 'params_now'), incompatible: count(head, 'incompatible') ?? 0, callers }
}

/** At most this many callers are named; the rest are counted. */
const MAX_CALLERS = 10

function paramsText(c: Check): string {
  if (c.paramsWas === undefined || c.paramsNow === undefined || c.paramsWas === c.paramsNow) return 'changed its parameters'
  return `changed from ${c.paramsWas} to ${c.paramsNow} parameter(s)`
}

function namedCallers(c: Check): string {
  const named = c.callers.slice(0, MAX_CALLERS).map(x => `${x.name} (${x.at})`).join(', ')
  return c.callers.length > MAX_CALLERS ? `${named} and ${c.callers.length - MAX_CALLERS} more` : named
}

/** Whether this check has something to report: a changed contract that something calls. */
function isReported(c: Check): boolean {
  return c.status === 'contract-change' && c.callers.length > 0
}

/** The note for one changed contract, or undefined when nothing calls it. */
export function noteText(c: Check): string | undefined {
  if (!isReported(c)) return undefined
  return `contract-watch: ${c.sym} ${paramsText(c)} since the last commit; check each caller: ${namedCallers(c)}.`
}

/**
 * The transcript line for one changed contract: the finding alone, without the instruction the model
 * reads, or undefined when nothing calls it. The engine adds the mod name.
 */
export function logText(c: Check): string | undefined {
  if (!isReported(c)) return undefined
  return `${c.sym} ${paramsText(c)}; callers: ${namedCallers(c)}`
}

/** A sidebar line, as the sidebar mod's contract names it. */
type Line = { text: string; kind: 'error' | 'dim' }

/** The change on the first line, then one line per caller, so the section reads as a list. */
export function sidebarLines(c: Check): Line[] {
  const named = c.callers.slice(0, MAX_CALLERS).map(x => ({ text: `${x.name} (${x.at})`, kind: 'dim' as const }))
  const rest = c.callers.length - MAX_CALLERS
  if (rest > 0) named.push({ text: `${rest} more`, kind: 'dim' })
  return [{ text: `${c.sym} ${paramsText(c)}`, kind: 'error' }, ...named]
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

/** The transcript line of a finding a later check closed. */
export function doneLog(sym: string): string {
  return `every caller matches ${sym} again`
}

/** The sidebar lines of a closed finding. */
export function doneLines(sym: string): { text: string; kind: 'ok' }[] {
  return [{ text: doneLog(sym), kind: 'ok' }]
}

/** The global flags git takes before the subcommand, so `git -c user.name=x commit` is still a commit. */
const GIT_FLAG = String.raw`(?:\s+-[cC]\s+\S+|\s+--(?:git-dir|work-tree|namespace)=\S+|\s+--(?:no-pager|no-replace-objects|bare|literal-pathspecs|paginate))`

/** A `git commit`, `git push` or `git merge` the gate stops while a finding is open. */
const GUARDED = new RegExp(String.raw`(^|[\s;&|(])git(?:${GIT_FLAG})*\s+(commit|push|merge)\b`)
const ASKING = /\s(--dry-run|--help|-h)(\s|$)/

export function isGuarded(command: string): boolean {
  return GUARDED.test(command) && !ASKING.test(command)
}

/** The mode of the mod: a note only, or a note and a gate on git commit, push and merge. */
export type Mode = 'note' | 'deny'

/** The mode a `/contract-watch mode <word>` argument names, or undefined when it is not one. */
export function modeOf(arg: string): Mode | undefined {
  return arg === 'note' || arg === 'deny' ? arg : undefined
}

/** The deny text both the model and the person read: which callers do not match, and the one way out. */
export function denyText(lines: readonly string[]): string {
  return `stopped: ${lines.length} changed signature(s) leave a caller behind: ${lines.join(' · ')}. Bring each caller to the new signature, then run the command again; there is no way around this gate, and only the person turns it off with /contract-watch mode note.`
}

/** A sidebar section key: the subject cut to what the sidebar takes, so one symbol keeps one section. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
