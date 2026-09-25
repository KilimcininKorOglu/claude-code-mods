/**
 * What session-watch reads and how it draws it: the token totals it adds up, the git status it parses,
 * and the sidebar and status lines. Nothing here reads the engine or the clock.
 */

/** The tokens of every turn so far, by kind. */
export type Split = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const NO_SPLIT: Split = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** The token counts one turn carries, as `turn.complete` names them. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** A split with one more turn's tokens added. */
export function addSplit(split: Split, usage: Usage | undefined): Split {
  if (usage === undefined) return split
  return {
    input: split.input + (usage.input_tokens ?? 0),
    output: split.output + (usage.output_tokens ?? 0),
    cacheRead: split.cacheRead + (usage.cache_read_input_tokens ?? 0),
    cacheWrite: split.cacheWrite + (usage.cache_creation_input_tokens ?? 0),
  }
}

const totalOf = (s: Split): number => s.input + s.output + s.cacheRead + s.cacheWrite

/** A token count as `830`, `245k` or `1.2M`. */
export function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

function isSplit(v: unknown): v is Split {
  const s = v as Partial<Split> | null
  return typeof s === 'object' && s !== null && isCount(s.input) && isCount(s.output) && isCount(s.cacheRead) && isCount(s.cacheWrite)
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
  model: string
  effort: Effort
  version: string
  git?: GitState
}

/** How the sidebar colours a line. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Line = { text: string; kind?: Tone }

/** The context's colour: green under 50%, yellow from 50% to 80%, red above 80%. */
export function contextTone(percent: number): Tone {
  if (percent < 50) return 'ok'
  return percent <= 80 ? 'warn' : 'error'
}

function contextLine(c: Reading['context']): Line {
  if (c.percent === undefined) return { text: 'context: no reply yet', kind: 'dim' }
  return { text: `context ${c.percent}% · ${fmtTok(c.tokens ?? 0)} / ${fmtTok(c.window)}`, kind: contextTone(c.percent) }
}

function tokensLine(s: Split): Line {
  return { text: `tokens T ${fmtTok(totalOf(s))} · I ${fmtTok(s.input)} · O ${fmtTok(s.output)} · CR ${fmtTok(s.cacheRead)} · CW ${fmtTok(s.cacheWrite)}` }
}

function costLine(usd: number | undefined): Line {
  return usd === undefined ? { text: 'cost: no ledger in this host', kind: 'dim' } : { text: `cost $${usd.toFixed(2)}` }
}

/** The model as a line names it: without the vendor prefix and the date a full id carries. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

function effortText(effort: Effort): string {
  if (effort === undefined) return 'thinking: not read yet'
  if (effort === null) return 'no thinking setting'
  return typeof effort === 'number' ? `thinking budget ${effort}` : `thinking ${effort}`
}

function modelLine(model: string, effort: Effort): Line {
  return { text: `model ${shortModel(model)} · ${effortText(effort)}` }
}

/** The git line: branch, changes and upstream, yellow while the tree has changes and green when clean. */
export function gitLine(git: GitState | undefined): Line {
  if (git === undefined) return { text: 'git: not read yet', kind: 'dim' }
  if (git.kind === 'none') return { text: 'git: not a repository', kind: 'dim' }
  if (git.kind === 'error') return { text: `git: ${git.message}`, kind: 'dim' }
  const upstream = git.ab === undefined ? 'no upstream' : `↑${git.ab.ahead} ↓${git.ab.behind}`
  return { text: `${git.head} · ${changesText(git)} · ${upstream}`, kind: isDirty(git) ? 'warn' : 'ok' }
}

/** The reading as the sidebar section's lines, in the order the person reads them. */
export function sidebarLines(r: Reading): Line[] {
  return [contextLine(r.context), tokensLine(r.split), costLine(r.costUsd), modelLine(r.model, r.effort), { text: `Claude Code ${r.version}` }, gitLine(r.git)]
}

/** The short status line while the sidebar is closed: `ctx 24% · $1.23 · main*`. */
export function statusText(r: Reading): string {
  const ctx = r.context.percent === undefined ? 'ctx -' : `ctx ${r.context.percent}%`
  const cost = r.costUsd === undefined ? [] : [`$${r.costUsd.toFixed(2)}`]
  const git = r.git?.kind === 'repo' ? [`${r.git.head}${isDirty(r.git) ? '*' : ''}`] : []
  return [ctx, ...cost, ...git].join(' · ')
}
