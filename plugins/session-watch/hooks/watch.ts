/**
 * What session-watch reads and how it draws it: the token totals it adds up, the git status it parses,
 * and the sidebar and status lines. Nothing here reads the engine or the clock.
 */

/** The tokens of every turn so far, by kind. `thinking` is a part of `output`, read from the transcripts alone. */
export type Split = { input: number; output: number; cacheRead: number; cacheWrite: number; thinking: number }

export const NO_SPLIT: Split = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 }

/**
 * The token counts one turn carries, as `turn.complete` names them. A transcript line also carries
 * `output_tokens_details.thinking_tokens`, which no hook's usage holds (measured on 2.1.283).
 */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens_details?: { thinking_tokens?: unknown } | null
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** A count read from a usage record, which a transcript line makes untrusted; another value reads as 0. */
const countOf = (v: unknown): number => (isCount(v) ? v : 0)

/** A split with one more turn's tokens added. */
export function addSplit(split: Split, usage: Usage | undefined): Split {
  if (usage === undefined) return split
  return {
    input: split.input + countOf(usage.input_tokens),
    output: split.output + countOf(usage.output_tokens),
    cacheRead: split.cacheRead + countOf(usage.cache_read_input_tokens),
    cacheWrite: split.cacheWrite + countOf(usage.cache_creation_input_tokens),
    thinking: split.thinking + thinkingIn(usage),
  }
}

/** The thinking tokens a usage record names; 0 where it names none, as every hook's usage does. */
export function thinkingIn(usage: Usage): number {
  return countOf(usage.output_tokens_details?.thinking_tokens)
}

/**
 * The usage a model call's or a compaction's result carries, or undefined where it made no request (a
 * fork with nothing to fork, a skipped compaction, a compaction a hook answered).
 */
export function usageOf(result: unknown): Usage | undefined {
  const usage = typeof result === 'object' && result !== null ? (result as { usage?: unknown }).usage : undefined
  return typeof usage === 'object' && usage !== null ? (usage as Usage) : undefined
}

/** The value an op event's result carries (`{ value }`), or undefined for a `{ deny }`. */
export function valueOf(result: unknown): unknown {
  return typeof result === 'object' && result !== null ? (result as { value?: unknown }).value : undefined
}

/** Two splits added. */
export function sumSplits(a: Split, b: Split): Split {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, thinking: a.thinking + b.thinking }
}

const totalOf = (s: Split): number => s.input + s.output + s.cacheRead + s.cacheWrite

/** A token count as `830`, `245k`, `1.2M` or `3.1B`. */
export function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/**
 * The directory of a session's transcripts: under `projects/`, named after the session's start directory
 * with every character but a letter or a digit turned into `-` (measured on 2.1.280). It holds
 * `<session id>.jsonl` and, for a session that ran subagents, `<session id>/subagents/*.jsonl`.
 */
export function transcriptDir(configDir: string, root: string): string {
  return `${configDir}/projects/${root.replace(/[^A-Za-z0-9]/g, '-')}`
}

/**
 * A transcript read piece by piece: the usage of each model response, by message id. The engine writes
 * one line per content block of a response, each with the response's usage, so a response counts once;
 * its last line wins, because a streamed response's earlier lines can carry a smaller output count.
 */
export type UsageScanner = { rest: string; byId: Map<string, Usage>; noId: Split }

export const usageScannerOf = (): UsageScanner => ({ rest: '', byId: new Map(), noId: NO_SPLIT })

type UsageRow = { type?: unknown; message?: { id?: unknown; usage?: unknown } }

/** The row a line holds, or undefined for a line that is not JSON (a line cut at the snapshot's end). */
function rowOf(line: string): UsageRow | undefined {
  try {
    return JSON.parse(line) as UsageRow
  } catch {
    return undefined
  }
}

/** A model response's id and usage, from a transcript line, or undefined for a line of another kind. */
function responseOf(line: string): { id: unknown; usage: Usage } | undefined {
  // Parsing every row of a long transcript costs more than it needs: only a response's own row counts.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return undefined
  const row = rowOf(line)
  const usage = row?.message?.usage
  if (row?.type !== 'assistant' || typeof usage !== 'object' || usage === null) return undefined
  return { id: row.message?.id, usage: usage as Usage }
}

function takeUsageLine(s: UsageScanner, line: string): void {
  const r = responseOf(line)
  if (r === undefined) return
  if (typeof r.id === 'string') s.byId.set(r.id, r.usage)
  else s.noId = addSplit(s.noId, r.usage)
}

/** Reads the next piece of a transcript; a line cut between pieces waits for the rest. */
export function scanUsage(s: UsageScanner, text: string): void {
  const lines = (s.rest + text).split('\n')
  s.rest = lines.pop() ?? ''
  for (const line of lines) takeUsageLine(s, line)
}

/** Reads what is left after a file's last piece, so the next file starts on a line of its own. */
export function endFile(s: UsageScanner): void {
  if (s.rest.trim() !== '') takeUsageLine(s, s.rest)
  s.rest = ''
}

/** The totals of every transcript read so far. */
export function usageTotal(s: UsageScanner): Split {
  endFile(s)
  return [...s.byId.values()].reduce(addSplit, s.noId)
}

/** The thinking tokens of every response a scanner has read, each response once. */
export function thinkingOf(s: UsageScanner): number {
  return [...s.byId.values()].reduce((a, u) => a + thinkingIn(u), s.noId.thinking)
}

/** The thinking tokens of the last response a scanner has read, or undefined before one. */
export function lastThinkingOf(s: UsageScanner): number | undefined {
  const last = [...s.byId.values()].at(-1)
  return last === undefined ? undefined : thinkingIn(last)
}

/**
 * A stored split. One kept before thinking was counted has no `thinking` and reads as none, so the
 * session's transcripts are read again and the totals hold it.
 */
function isSplit(v: unknown): v is Split {
  const s = v as Partial<Split> | null
  return typeof s === 'object' && s !== null && isCount(s.input) && isCount(s.output) && isCount(s.cacheRead) && isCount(s.cacheWrite) && isCount(s.thinking)
}

/** How many sessions' totals the store keeps, so the file does not grow with every session. */
const KEPT_SESSIONS = 20

/** The totals the store keeps, by session id; a value of another shape reads as none. */
export function storedSplits(value: unknown): Record<string, Split> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, s]) => isSplit(s))) as Record<string, Split>
}

/** The stored totals with this session's written last, the oldest dropped past the kept number. */
export function withSplit(stored: Record<string, Split>, sid: string, split: Split): Record<string, Split> {
  const others = Object.entries(stored).filter(([id]) => id !== sid)
  return Object.fromEntries([...others, [sid, split] as const].slice(-KEPT_SESSIONS))
}

/** The working tree as `git status --porcelain=v2 --branch` reports it. */
export type Tree = {
  kind: 'repo'
  /** The branch, or `detached at <sha>`. */
  head: string
  /** Commits ahead of and behind the upstream, or undefined when the branch has none. */
  ab?: { ahead: number; behind: number }
  staged: number
  modified: number
  untracked: number
  conflicted: number
}

/** The git state: a tree, no repository, or why git did not answer. */
export type GitState = Tree | { kind: 'none' } | { kind: 'error'; message: string }

const EMPTY_TREE: Tree = { kind: 'repo', head: '', staged: 0, modified: 0, untracked: 0, conflicted: 0 }

/** One header line (`# branch.head main`) read into the tree. */
function readHeader(tree: Tree, line: string, oid: string): Tree {
  const [, key = '', ...rest] = line.split(' ')
  const value = rest.join(' ')
  if (key === 'branch.head') return { ...tree, head: value === '(detached)' ? `detached at ${oid.slice(0, 7)}` : value }
  const ab = /^\+(\d+) -(\d+)$/.exec(value)
  return key === 'branch.ab' && ab !== null ? { ...tree, ab: { ahead: Number(ab[1]), behind: Number(ab[2]) } } : tree
}

/** One entry line (`1 .M ...`, `? path`) counted into the tree. */
function readEntry(tree: Tree, line: string): Tree {
  if (line.startsWith('? ')) return { ...tree, untracked: tree.untracked + 1 }
  if (line.startsWith('u ')) return { ...tree, conflicted: tree.conflicted + 1 }
  if (!line.startsWith('1 ') && !line.startsWith('2 ')) return tree
  const [x = '.', y = '.'] = line.slice(2, 4)
  return { ...tree, staged: tree.staged + (x === '.' ? 0 : 1), modified: tree.modified + (y === '.' ? 0 : 1) }
}

/** The tree `git status --porcelain=v2 --branch` printed. */
export function parseStatus(stdout: string): Tree {
  const lines = stdout.split('\n').filter(l => l !== '')
  const oid = lines.find(l => l.startsWith('# branch.oid '))?.slice('# branch.oid '.length) ?? ''
  return lines.reduce((tree, line) => (line.startsWith('# ') ? readHeader(tree, line, oid) : readEntry(tree, line)), EMPTY_TREE)
}

/** The git state of a git run that failed: no repository here, or git's own first line. */
export function failedGit(stderr: string): GitState {
  if (/not a git repository/i.test(stderr)) return { kind: 'none' }
  return { kind: 'error', message: stderr.split('\n').find(l => l.trim() !== '')?.trim() ?? 'git failed' }
}

const isDirty = (t: Tree): boolean => t.staged + t.modified + t.untracked + t.conflicted > 0

/** The changes as `2 staged, 3 modified, 1 untracked`, or `clean`. */
function changesText(t: Tree): string {
  const parts = [[t.staged, 'staged'], [t.modified, 'modified'], [t.untracked, 'untracked'], [t.conflicted, 'conflicted']] as const
  const named = parts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`)
  return named.length === 0 ? 'clean' : named.join(', ')
}

/** The thinking setting of the main loop's last request: a level, a budget, none for a model without one, or not read yet. */
export type Effort = string | number | null | undefined

/** Everything one reading shows. */
export type Reading = {
  context: { tokens?: number; window: number; percent?: number }
  costUsd?: number
  split: Split
  /** The split of the last main-loop request, which holds the context window now; unknown before one. */
  last?: Split
  /** Whether the session's transcripts are still being read into the totals. */
  seeding: boolean
  model: string
  effort: Effort
  version: string
  git?: GitState
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The context's colour: green under 50%, yellow from 50% to 80%, red above 80%. */
export function contextTone(percent: number): Tone {
  if (percent < 50) return 'ok'
  return percent <= 80 ? 'warn' : 'error'
}

/**
 * The context line: the window's fill, then the split of the last main-loop request, the one that holds the
 * window now. Without that request's split the whole line takes the fill's colour, as before; with it only
 * the two percentages are coloured.
 */
function contextLine(c: Reading['context'], last: Split | undefined): Line {
  if (c.percent === undefined) return { text: 'ctx: no reply yet', kind: 'dim' }
  const fill = ` · ${fmtTok(c.tokens ?? 0)} / ${fmtTok(c.window)}`
  if (last === undefined) return { text: `ctx ${c.percent}%${fill}`, kind: contextTone(c.percent) }
  return partsLine([part('ctx ', undefined), part(`${c.percent}%`, contextTone(c.percent)), part(fill, undefined), ...splitParts(last)])
}

/**
 * The share of the input tokens read from the cache, in whole percent rounded down, so a session with any
 * cold write never reads 100%; undefined before any input.
 */
export function cacheHit(s: Split): number | undefined {
  const input = s.input + s.cacheRead + s.cacheWrite
  return input === 0 ? undefined : Math.floor((100 * s.cacheRead) / input)
}

/** The cache hit's colour: green from 90%, yellow from 70% to 90%, red under 70%. */
export function cacheHitTone(percent: number): Tone {
  if (percent >= 90) return 'ok'
  return percent >= 70 ? 'warn' : 'error'
}

/** A split by kind, then its cache hit with only the percentage coloured; no hit before any input. */
function splitParts(s: Split): Part[] {
  const kinds = part(` · I ${fmtTok(s.input)} · O ${fmtTok(s.output)} · TH ${fmtTok(s.thinking)} · CR ${fmtTok(s.cacheRead)} · CW ${fmtTok(s.cacheWrite)}`, undefined)
  const hit = cacheHit(s)
  return hit === undefined ? [kinds] : [kinds, part(' · CH ', undefined), part(`${hit}%`, cacheHitTone(hit))]
}

function tokensLine(s: Split, seeding: boolean): Line {
  if (seeding) return { text: 'tokens: reading the transcripts', kind: 'dim' }
  const [kinds, ...hit] = splitParts(s)
  const totals = part(`tokens T ${fmtTok(totalOf(s))}${kinds?.text ?? ''}`, undefined)
  return hit.length === 0 ? { text: totals.text } : partsLine([totals, ...hit])
}

function costLine(usd: number | undefined): Line {
  return usd === undefined ? { text: 'cost: no ledger in this host', kind: 'dim' } : { text: `cost $${usd.toFixed(2)}` }
}

/** The model as a line names it: without the vendor prefix and the date a full id carries. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/** The model's colour by family, the dearest the warmest: opus red, fable yellow, sonnet green, haiku faint. */
export function modelTone(model: string): Tone | undefined {
  const families: [RegExp, Tone][] = [[/opus/i, 'error'], [/fable/i, 'warn'], [/sonnet/i, 'ok'], [/haiku/i, 'dim']]
  return families.find(([family]) => family.test(model))?.[1]
}

/** The thinking level's colour: low faint, medium green, high yellow, xhigh and max red; a budget has none. */
export function effortTone(effort: Effort): Tone | undefined {
  const tones: Record<string, Tone> = { low: 'dim', medium: 'ok', high: 'warn', xhigh: 'error', max: 'error' }
  return typeof effort === 'string' ? tones[effort] : undefined
}

/** The thinking part: the label and the value, only the value coloured. */
function effortParts(effort: Effort): Part[] {
  if (effort === undefined) return [part('thinking: not read yet', 'dim')]
  if (effort === null) return [part('no thinking setting', 'dim')]
  if (typeof effort === 'number') return [part(`thinking budget ${effort}`, undefined)]
  return [part('thinking ', undefined), part(effort, effortTone(effort))]
}

function modelLine(model: string, effort: Effort): Line {
  return partsLine([part('model ', undefined), part(shortModel(model), modelTone(model)), part(' · ', undefined), ...effortParts(effort)])
}

/** The git line: branch, changes and upstream, yellow while the tree has changes and green when clean. */
export function gitLine(git: GitState | undefined): Line {
  if (git === undefined) return { text: 'git: not read yet', kind: 'dim' }
  if (git.kind === 'none') return { text: 'git: this folder is not a git repository', kind: 'dim' }
  if (git.kind === 'error') return { text: `git: ${git.message}`, kind: 'dim' }
  const upstream = git.ab === undefined ? 'no upstream' : `↑${git.ab.ahead} ↓${git.ab.behind}`
  return { text: `${git.head} · ${changesText(git)} · ${upstream}`, kind: isDirty(git) ? 'warn' : 'ok' }
}

/** The reading as the sidebar section's lines, in the order the person reads them. */
export function sidebarLines(r: Reading): Line[] {
  return [contextLine(r.context, r.last), tokensLine(r.split, r.seeding), costLine(r.costUsd), modelLine(r.model, r.effort), { text: `Claude Code ${r.version}` }, gitLine(r.git)]
}

/** The short status line while the sidebar is closed: `ctx 24% · $1.23 · main*`. */
export function statusText(r: Reading): string {
  const ctx = r.context.percent === undefined ? 'ctx -' : `ctx ${r.context.percent}%`
  const cost = r.costUsd === undefined ? [] : [`$${r.costUsd.toFixed(2)}`]
  const git = r.git?.kind === 'repo' ? [`${r.git.head}${isDirty(r.git) ? '*' : ''}`] : []
  return [ctx, ...cost, ...git].join(' · ')
}
