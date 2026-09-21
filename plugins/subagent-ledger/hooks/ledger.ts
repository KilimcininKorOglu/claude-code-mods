/** What each subagent of the session spent, and how the pane reads it. */

/** The tokens one subagent may spend before its row turns red, in thousands. */
export const DEFAULT_LIMIT_K = 200

/** The band `/subagent-ledger limit <k>` takes; a value outside it is refused, never clamped. */
export const MIN_LIMIT_K = 1
export const MAX_LIMIT_K = 10_000

/** The pane draws this many subagents, the costliest first; the rest are counted. */
export const ROWS = 5

/** One subagent's run: what it is, what it runs on, and what it has spent so far. */
export type Run = { type: string; description: string; model: string; turns: number; ms: number; tokens: number }

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
const MAX_LABEL = 28

/** The label of one run: its agent type, and its own description after it while it fits. */
export function labelOf(run: Run): string {
  const full = run.description === '' ? run.type : `${run.type}: ${run.description}`
  return full.length <= MAX_LABEL ? full : `${full.slice(0, MAX_LABEL - 1)}…`
}

/** One row of the pane: what the subagent is, what it runs on, its turns, its time and its tokens. */
export function rowText(run: Run): string {
  const model = run.model === '' ? '' : `${shortModel(run.model)} · `
  return `${labelOf(run)} · ${model}${run.turns} turn · ${fmtDuration(run.ms)} · ${fmtTok(run.tokens)}`
}

/** The runs the pane draws, the costliest first. */
export function ranked(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => b.tokens - a.tokens || b.ms - a.ms)
}

/** A sidebar line, as the sidebar mod's contract names it. */
type Line = { text: string; kind: 'ok' | 'error' | 'dim' }

/**
 * The pane's lines: one row per subagent, the costliest first, red once a subagent passed the limit. The
 * rows past the fifth are one faint line, so a fan-out of twenty agents still holds six rows.
 */
export function sidebarLines(runs: readonly Run[], limitK: number): Line[] {
  const order = ranked(runs)
  const lines: Line[] = order.slice(0, ROWS).map(run => ({ text: rowText(run), kind: run.tokens >= limitK * 1000 ? 'error' : 'ok' }))
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
