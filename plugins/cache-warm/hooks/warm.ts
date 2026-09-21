import { breakEvenPings, priceOf, readUsd, writeUsd, type Usage } from './pricing.ts'

const MIN = 60 * 1000
const HOUR = 60 * MIN

/** The 1-hour cache tier the main conversation uses. */
export const TTL_MS = HOUR
/** The ping lands this long after the last request, well inside the hour. */
export const PING_AFTER_MS = 50 * MIN
/** The floor of the `every` test setting. */
export const MIN_PING_MS = MIN
/** The window armed after a paid cold write. */
export const AUTO_WARM_MS = 6 * HOUR
/** The window of a bare /cache-warm and of `always`. */
export const DEFAULT_WINDOW_MS = 6 * HOUR
/** Below this context a cold resume is not worth a line. */
export const BIG_TOKENS = 50_000
/** A turn is a cold write only when the context before it was at least this large. */
const COLD_WRITE_MIN_CONTEXT = 20_000
/** A warm ping writes only its own message; a write of this share of the read or more means the prefix broke. */
const WARM_WRITE_RATIO = 0.1

export interface PingRecord {
  read: number
  write: number
  usd: number | null
}

export interface ColdWrite {
  tokens: number
  usd: number | null
}

export interface State {
  sid: string
  /** When the keep-warm window ends; 0 means off. */
  deadline: number
  every: number
  always: boolean
  lastRequestAt: number
  model: string | null
  ctx: number
  compacted: boolean
  coldWrites: ColdWrite[]
  pending: { cancel: () => void } | null
  lastPing: PingRecord | null
  stopped: string | null
  /** The short form of the last transcript line, drawn faint under the window line in the sidebar. */
  event?: string
}

export function freshState(): State {
  return {
    sid: '', deadline: 0, every: PING_AFTER_MS, always: false, lastRequestAt: 0, model: null, ctx: 0,
    compacted: false, coldWrites: [], pending: null, lastPing: null, stopped: null,
  }
}

export function parseDuration(text: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * MIN
}

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / MIN))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function fmtUsd(usd: number | null): string {
  if (usd == null) return 'n/a'
  return '$' + (usd >= 100 ? usd.toFixed(0) : usd.toFixed(2))
}

export function fmtTok(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

export type WarmCommand =
  | { kind: 'arm'; window: number; every: number }
  | { kind: 'always' | 'off' | 'status' }
  | { kind: 'error'; text: string }

const USAGE = 'expects a window such as 6h or 90m, or always, off, or status'

function parseEvery(words: readonly string[]): number | null {
  if (words[0] === undefined) return PING_AFTER_MS
  if (words[0] !== 'every' || words.length !== 2) return null
  const period = parseDuration(words[1] ?? '')
  return period != null && period >= MIN_PING_MS ? period : null
}

/** Reads the argument of /cache-warm. */
export function parseWarmArgs(args: string): WarmCommand {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [first, ...rest] = words
  if (first === undefined) return { kind: 'arm', window: DEFAULT_WINDOW_MS, every: PING_AFTER_MS }
  if ((first === 'always' || first === 'off' || first === 'status') && rest.length === 0) return { kind: first }
  const window = parseDuration(first)
  if (window == null || window === 0) return { kind: 'error', text: USAGE }
  const every = parseEvery(rest)
  if (every == null) return { kind: 'error', text: 'every takes a period of at least 1m, as in 6h every 2m' }
  return { kind: 'arm', window, every }
}

export function isCold(s: State, now: number): boolean {
  return s.lastRequestAt > 0 && !s.compacted && now - s.lastRequestAt >= TTL_MS
}

export function isWarmPing(u: Usage): boolean {
  return u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < WARM_WRITE_RATIO * u.cache_read_input_tokens
}

/** A turn re-wrote the context when it wrote at least half of a sizeable context. */
export function isColdWrite(previousContext: number, write: number): boolean {
  return previousContext > COLD_WRITE_MIN_CONTEXT && write >= 0.5 * previousContext
}

export function coldPingText(u: Usage, usd: number | null): string {
  return `the ping read ${fmtTok(u.cache_read_input_tokens)} and wrote ${fmtTok(u.cache_creation_input_tokens)} tokens (${fmtUsd(usd)}), the cache was already gone`
}

/** The status line; undefined clears it. The engine puts the mod name in front. */
export function statusText(s: State, now: number): string | undefined {
  if (s.stopped) return `stopped: ${s.stopped}`
  if (!s.deadline) return undefined
  const next = s.lastRequestAt && !s.compacted ? ` · ping in ${fmtDuration(s.lastRequestAt + s.every - now)}` : ' · waiting for the first turn'
  const ping = s.lastPing ? ` · last ping read ${fmtTok(s.lastPing.read)} ${fmtUsd(s.lastPing.usd)}` : ''
  return `${fmtDuration(s.deadline - now)} left${next}${ping}`
}

/**
 * The sidebar line while no window runs: what this session paid for cold writes and how large the
 * context is. It replaces the stop reason at the next turn, so the pane holds a measurement of now
 * instead of one sentence of the window that ended. The transcript keeps the reason.
 */
export function idleText(s: State): string {
  const count = s.coldWrites.length
  const paid = s.coldWrites.reduce((sum, w) => sum + (w.usd ?? 0), 0)
  const writes = count === 0 ? 'no cold write' : `${count} cold write${count === 1 ? '' : 's'} paid ${fmtUsd(paid)}`
  const context = s.ctx > 0 ? ` · context ${fmtTok(s.ctx)} tokens` : ''
  return `off · ${writes}${context}`
}

/**
 * The colour of that line in the sidebar: red for a window the mod stopped, yellow while the window
 * ends within one ping period (no further ping renews it), green while it holds, faint before the
 * first turn, when there is nothing to keep warm yet.
 */
export function statusTone(s: State, now: number): 'ok' | 'warn' | 'error' | 'dim' {
  if (s.stopped) return 'error'
  if (!s.lastRequestAt || s.compacted) return 'dim'
  return s.deadline - now <= s.every ? 'warn' : 'ok'
}

/** How many characters of the last event the sidebar's second line holds. */
const MAX_EVENT = 120

/** A transcript line as the sidebar's second line: cut, because the pane holds one row for it. */
export function eventShort(text: string): string {
  return text.length > MAX_EVENT ? `${text.slice(0, MAX_EVENT - 1)}…` : text
}

/** The cold write as the sidebar's second line: what it cost, without the instruction the line carries. */
export function coldWriteShort(tokens: number, usd: number | null): string {
  return `cold write ${fmtTok(tokens)} tokens paid (${fmtUsd(usd)})`
}

export type ResumeFields = {
  source: string
  model?: string
  context_tokens?: number
  seconds_since_last_response?: number
  prompt_cache_likely_expired?: boolean
  estimated_cache_write_usd?: number
}

/** Applies the fields Claude Code computes for a resumed session; returns the line to log, if any. */
export function seedFromResume(s: State, e: ResumeFields, now: number): string | null {
  if (e.source !== 'resume' && e.source !== 'fork') return null
  if (typeof e.context_tokens === 'number' && e.context_tokens > 0) s.ctx = e.context_tokens
  if (typeof e.seconds_since_last_response === 'number') s.lastRequestAt = now - e.seconds_since_last_response * 1000
  if (typeof e.model === 'string') s.model = e.model
  s.compacted = false
  if (e.prompt_cache_likely_expired !== true || s.ctx < BIG_TOKENS) return null
  const usd = typeof e.estimated_cache_write_usd === 'number' ? e.estimated_cache_write_usd : writeUsd(s.ctx, priceOf(s.model))
  return `resuming cold. The first message re-writes ${fmtCount(s.ctx)} tokens, about ${fmtUsd(usd)}.`
}

/** /clear starts a new conversation in the same process; nothing measured before it still applies. */
export function resetForClear(s: State): void {
  s.pending?.cancel()
  s.pending = null
  s.ctx = 0
  s.lastRequestAt = 0
  s.compacted = false
  s.coldWrites = []
  s.lastPing = null
  s.stopped = null
  s.event = undefined
}

function stateLine(s: State, now: number): string {
  if (s.compacted) return 'reset by compaction, waiting for the first turn'
  if (!s.lastRequestAt) return 'no request yet this session'
  if (isCold(s, now)) return `COLD, last request ${fmtDuration(now - s.lastRequestAt)} ago`
  return `warm, ${fmtDuration(s.lastRequestAt + TTL_MS - now)} left`
}

function warmLine(s: State, now: number): string {
  const always = s.always ? ' (always)' : ''
  if (s.deadline) return `on, ${statusText(s, now) ?? ''}${always}`
  if (s.stopped) return `stopped, ${s.stopped}${always}`
  if (s.always) return `off until the next session start or /clear, which arm ${fmtDuration(DEFAULT_WINDOW_MS)} (always)`
  return `off (/cache-warm arms it for ${fmtDuration(DEFAULT_WINDOW_MS)})`
}

function breakEvenLine(s: State): string | null {
  const pings = breakEvenPings(priceOf(s.model))
  if (pings == null || s.ctx <= 0) return null
  return `up to ${pings} pings at the read rate cost one cold write, about ${fmtDuration(pings * s.every)} of idle at one ping per ${fmtDuration(s.every)}`
}

/** The /cache-status card. */
export function card(s: State, now: number): string {
  const price = priceOf(s.model)
  const paid = s.coldWrites.reduce((sum, w) => sum + (w.usd ?? 0), 0)
  const count = s.coldWrites.length
  const breakEven = breakEvenLine(s)
  return [
    s.model ?? 'model not seen yet',
    `state       ${stateLine(s, now)}`,
    `context     ${fmtCount(s.ctx)} tokens`,
    `cold cost   ${fmtUsd(writeUsd(s.ctx, price))} to re-write it (warm turn ${fmtUsd(readUsd(s.ctx, price))})`,
    `keep warm   ${warmLine(s, now)}`,
    ...(breakEven ? [`break-even  ${breakEven}`] : []),
    `session     ${count} cold write${count === 1 ? '' : 's'} paid, ${fmtUsd(paid)}`,
  ].join('\n')
}
