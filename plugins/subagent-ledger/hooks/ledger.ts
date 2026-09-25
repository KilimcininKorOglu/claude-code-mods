/** What each subagent of the session spent, and how the pane reads it. */

/** The tokens one subagent may spend before its row turns red, in thousands. */
export const DEFAULT_LIMIT_K = 200

/** The band `/subagent-ledger limit <k>` takes; a value outside it is refused, never clamped. */
export const MIN_LIMIT_K = 1
export const MAX_LIMIT_K = 10_000

/** The pane draws this many subagents, the costliest first; the rest are counted. */
export const ROWS = 5

/** Where a subagent stands: its loop runs, it answered, or its run ended without an answer. */
export type Status = 'running' | 'done' | 'stopped'

/** The tokens of a run by kind: the input the cache did not serve, the output, the cache reads and the cache writes. */
export type Split = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const NO_SPLIT: Split = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * One subagent's run: what it is, what it runs on, what it has spent so far, and where it stands. `tokens`
 * is the sum of `split`, kept whole because the order, the limit and the totals read it.
 */
export type Run = { type: string; description: string; model: string; turns: number; ms: number; tokens: number; split: Split; status: Status }

/** The status a subagent's `turn.complete` leaves: done on an answer, stopped on an interrupt, an error or a refusal. */
export function statusAfter(reason: string): Status {
  return reason === 'answer' ? 'done' : 'stopped'
}

/** The token counts of one turn, and the model that answered it, as `turn.complete` carries them. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  model?: string
}

/**
 * The model id as one row names it: without the vendor prefix and without the date a full id carries, so
 * `claude-haiku-4-5-20251001` reads as `haiku-4-5`. An id of another shape is drawn as it is.
 */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/** Every token of one turn: what was sent, what was cached, and what came back. */
export function tokensOf(usage: Usage | undefined): number {
  if (usage === undefined) return 0
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

/** A run's split with one more turn's tokens added. */
export function addSplit(split: Split, usage: Usage | undefined): Split {
  if (usage === undefined) return split
  return {
    input: split.input + (usage.input_tokens ?? 0),
    output: split.output + (usage.output_tokens ?? 0),
    cacheRead: split.cacheRead + (usage.cache_read_input_tokens ?? 0),
    cacheWrite: split.cacheWrite + (usage.cache_creation_input_tokens ?? 0),
  }
}

/** The row's token part after the total: the input, the output, the cache reads and the cache writes. */
function kindsText(split: Split): string {
  return ` · I ${fmtTok(split.input)} · O ${fmtTok(split.output)} · CR ${fmtTok(split.cacheRead)} · CW ${fmtTok(split.cacheWrite)}`
}

/** The row's token part: the total, then the input, the output, the cache reads and the cache writes. */
export function splitText(tokens: number, split: Split): string {
  return `T ${fmtTok(tokens)}${kindsText(split)}`
}

export function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** A duration in seconds under a minute, else minutes and seconds. */
export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${total % 60}s`
}

/** How wide a row's label may be, so one long description does not push the numbers off. */
const MAX_LABEL = 40

/** The label of one run: the work it was given, or its agent type when the spawn named none. */
export function labelOf(run: Run): string {
  const full = run.description === '' ? run.type : run.description
  return full.length <= MAX_LABEL ? full : `${full.slice(0, MAX_LABEL - 1)}…`
}

/** One row of the pane: what the subagent is, what it runs on, its turns, its time and its tokens by kind. */
export function rowText(run: Run): string {
  const model = run.model === '' ? '' : `${shortModel(run.model)} · `
  const stopped = run.status === 'stopped' ? ' · stopped' : ''
  return `${labelOf(run)} · ${model}${run.turns} turn · ${fmtDuration(run.ms)} · ${splitText(run.tokens, run.split)}${stopped}`
}

/** The runs the pane draws, the costliest first. */
export function ranked(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => b.tokens - a.tokens || b.ms - a.ms)
}

/** A sidebar line and a part of one, as the sidebar mod's contract names them. */
type Kind = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Kind }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Kind; parts?: Part[] }

const part = (text: string, kind: Kind | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The model's colour by family, the dearest the warmest: opus red, fable yellow, sonnet green, haiku faint. */
export function modelTone(model: string): Kind | undefined {
  const families: [RegExp, Kind][] = [[/opus/i, 'error'], [/fable/i, 'warn'], [/sonnet/i, 'ok'], [/haiku/i, 'dim']]
  return families.find(([family]) => family.test(model))?.[1]
}

/** The total's colour: red at or past the limit, yellow from 80% of it, the default under that. */
export function tokensTone(tokens: number, limitK: number): Kind | undefined {
  if (tokens >= limitK * 1000) return 'error'
  return tokens >= limitK * 800 ? 'warn' : undefined
}

/** The status word's colour: yellow while running, green when done, faint when stopped. */
const STATUS_TONE: Record<Status, Kind> = { running: 'warn', done: 'ok', stopped: 'dim' }

/**
 * One row of the pane in parts: the model coloured by its family, the total by the limit and the status
 * word by the status; the label, the turns, the time and the tokens by kind stay in the default colour.
 */
export function rowLine(run: Run, limitK: number): Line {
  const model = run.model === '' ? [] : [part(shortModel(run.model), modelTone(run.model)), part(' · ', undefined)]
  return partsLine([
    part(`${labelOf(run)} · `, undefined),
    ...model,
    part(`${run.turns} turn · ${fmtDuration(run.ms)} · `, undefined),
    part(`T ${fmtTok(run.tokens)}`, tokensTone(run.tokens, limitK)),
    part(kindsText(run.split), undefined),
    part(' · ', undefined),
    part(run.status, STATUS_TONE[run.status]),
  ])
}

/**
 * The pane's lines: one row per subagent, the costliest first, each drawn by `rowLine`. The rows past
 * the fifth are one faint line, so a fan-out of twenty agents still holds six rows.
 */
export function sidebarLines(runs: readonly Run[], limitK: number): Line[] {
  const order = ranked(runs)
  const lines: Line[] = order.slice(0, ROWS).map(run => rowLine(run, limitK))
  const rest = order.length - ROWS
  if (rest > 0) lines.push({ text: `${rest} more · ${fmtTok(order.slice(ROWS).reduce((sum, r) => sum + r.tokens, 0))}`, kind: 'dim' })
  return lines
}

/** The status line, drawn while the sidebar is closed: the totals in one line. */
export function totalText(runs: readonly Run[]): string | undefined {
  if (runs.length === 0) return undefined
  const turns = runs.reduce((sum, r) => sum + r.turns, 0)
  const ms = runs.reduce((sum, r) => sum + r.ms, 0)
  const tokens = runs.reduce((sum, r) => sum + r.tokens, 0)
  return `${runs.length} subagent · ${turns} turn · ${fmtDuration(ms)} · ${fmtTok(tokens)}`
}

/** The limit a `/subagent-ledger limit <word>` argument names, or undefined when it is not one. */
export function limitOf(arg: string): number | undefined {
  if (!/^\d{1,5}$/.test(arg)) return undefined
  const n = Number(arg)
  return n >= MIN_LIMIT_K && n <= MAX_LIMIT_K ? n : undefined
}

/** The answer of `/subagent-ledger limit <k>`, or of an argument it cannot read. */
export function limitText(limit: number | undefined): string {
  if (limit === undefined) return `limit expects a whole number of thousands of tokens from ${MIN_LIMIT_K} to ${MAX_LIMIT_K}`
  return `limit ${limit}k: a subagent over ${limit}k tokens is drawn red`
}

/** The `/subagent-ledger` answer: the setting, the limit, and every subagent of this session. */
export function statusText(enabled: boolean, runs: readonly Run[], limitK: number): string {
  const head = `${enabled ? 'on' : 'off'} · limit ${limitK}k · ${totalText(runs) ?? 'no subagent ran yet'}`
  return ranked(runs).length === 0 ? head : `${head}\n${ranked(runs).map(rowText).join('\n')}`
}
