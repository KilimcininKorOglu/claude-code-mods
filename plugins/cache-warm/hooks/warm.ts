import { breakEvenPings, hasFastRate, priceOf, readUsd, writeUsd, type Price, type Usage } from './pricing.ts'

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
  /** When the ping's answer came, in ms since the epoch. */
  at: number
}

export interface ColdWrite {
  tokens: number
  usd: number | null
}

export interface State {
  sid: string
  /** When the keep-warm window ends; 0 means off. `endless` runs with no deadline at all. */
  deadline: number
  /** The `always` loop: a ping every period until /cache-warm off, with no end time. */
  endless: boolean
  /** How long the running window was armed for, so one that runs out can start again as long. */
  window: number
  /** The window the next message of the person starts again; null when none ran out. */
  renew: { window: number; every: number } | null
  every: number
  always: boolean
  lastRequestAt: number
  model: string | null
  /** The `fastMode` setting is on and not reset per session, so a model with fast rates bills them. */
  fast: boolean
  ctx: number
  compacted: boolean
  coldWrites: ColdWrite[]
  pending: { cancel: () => void } | null
  lastPing: PingRecord | null
  stopped: string | null
  /** The short form of the last transcript line, drawn faint under the window line in the sidebar. */
  event?: Line
}

/** The rates the session bills now: its model, at fast mode rates while the setting says so. */
export function priceNow(s: State): Price | null {
  return priceOf(s.model, s.fast)
}

export function freshState(): State {
  return {
    sid: '', deadline: 0, endless: false, window: 0, renew: null, every: PING_AFTER_MS, always: false, lastRequestAt: 0, model: null, fast: false, ctx: 0,
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

/** True while the mod keeps the cache warm: a window with an end, or the endless `always` loop. */
export function hasWindow(s: State): boolean {
  return s.endless || s.deadline > 0
}

/** True when a window with an end has reached it. The endless loop never does. */
export function isOver(s: State, now: number): boolean {
  return !s.endless && s.deadline > 0 && now >= s.deadline
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

/** A fork result with no reply to score: nothing to fork yet, an API error, or a call cut before its reply. */
export type Unsent = { reason: 'nothing-to-fork' } | { reason: 'api-error'; status: number | null; error: string } | { reason: 'aborted' }

export function unsentText(r: Unsent): string {
  if (r.reason === 'nothing-to-fork') return 'the engine did not send the ping; the conversation has no reply to fork yet'
  if (r.reason === 'aborted') return 'the ping was cut before a reply came'
  return `the ping failed, the API answered ${r.status ?? 'nothing'} (${r.error})`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A local clock time as `05:42`, with the day and month in front when it is not today: `22 Sep 23:10`. */
export function clockText(at: number, now: number): string {
  const date = new Date(at)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return date.toDateString() === new Date(now).toDateString() ? time : `${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`
}

/** How the sidebar colours a line or a part of one. */
export type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

const joined = (parts: Part[]): string => parts.map(p => p.text).join('')

/** A line made of parts, its `text` their texts joined. */
export const partsLine = (parts: Part[]): Line => ({ text: joined(parts), parts })

/**
 * The window's state in parts; undefined while no window runs. Only the time left (or `always`) takes
 * the window's colour, the ping details are faint, and a stop shows its `stopped:` front red.
 */
export function statusParts(s: State, now: number): Part[] | undefined {
  if (s.stopped) return [part('stopped:', 'error'), part(` ${s.stopped}`, undefined)]
  if (!hasWindow(s)) return undefined
  const next = s.lastRequestAt && !s.compacted ? ` · ping in ${fmtDuration(s.lastRequestAt + s.every - now)}` : ' · waiting for the first turn'
  const ping = s.lastPing ? [part(` · last ping read ${fmtTok(s.lastPing.read)} ${fmtUsd(s.lastPing.usd)} (${clockText(s.lastPing.at, now)})`, 'dim')] : []
  const left = s.endless ? 'always' : `${fmtDuration(s.deadline - now)} left`
  return [part(left, statusTone(s, now)), part(next, 'dim'), ...ping]
}

/** The status line; undefined clears it. The engine puts the mod name in front. */
export function statusText(s: State, now: number): string | undefined {
  const parts = statusParts(s, now)
  return parts === undefined ? undefined : joined(parts)
}

/**
 * The sidebar line while no window runs, in parts: what this session paid for cold writes and how large
 * the context is. It replaces the stop reason at the next turn, so the pane holds a measurement of now
 * instead of one sentence of the window that ended. The transcript keeps the reason. The line is faint
 * but for a paid cold write, which is yellow.
 */
export function idleParts(s: State): Part[] {
  const count = s.coldWrites.length
  const paid = s.coldWrites.reduce((sum, w) => sum + (w.usd ?? 0), 0)
  const writes = count === 0 ? part('no cold write', 'dim') : part(`${count} cold write${count === 1 ? '' : 's'} paid ${fmtUsd(paid)}`, 'warn')
  const context = s.ctx > 0 ? [part(` · context ${fmtTok(s.ctx)} tokens`, 'dim')] : []
  const again = s.renew ? ` · ${fmtDuration(s.renew.window)} again at your next message` : ''
  return [part(`off${again} · `, 'dim'), writes, ...context]
}

export function idleText(s: State): string {
  return joined(idleParts(s))
}

/** The sidebar's first line: the window's state, or the idle line while none runs. */
export function windowLine(s: State, now: number): Line {
  return partsLine(statusParts(s, now) ?? idleParts(s))
}

/**
 * The colour of that line in the sidebar: red for a window the mod stopped, yellow while the window
 * ends within one ping period (no further ping renews it), green while it holds, faint before the
 * first turn, when there is nothing to keep warm yet.
 */
export function statusTone(s: State, now: number): 'ok' | 'warn' | 'error' | 'dim' {
  if (s.stopped) return 'error'
  if (!s.lastRequestAt || s.compacted) return 'dim'
  if (s.endless) return 'ok'
  return s.deadline - now <= s.every ? 'warn' : 'ok'
}

/** How many characters of the last event the sidebar's second line holds. */
const MAX_EVENT = 120

/** A transcript line as the sidebar's second line: faint, and cut, because the pane holds one row for it. */
export function eventShort(text: string): Line {
  return { text: text.length > MAX_EVENT ? `${text.slice(0, MAX_EVENT - 1)}…` : text, kind: 'dim' }
}

/** The cold write as the sidebar's second line: what it cost, without the instruction the line carries; the cost yellow. */
export function coldWriteShort(tokens: number, usd: number | null): Line {
  return partsLine([part(`cold write ${fmtTok(tokens)} tokens paid `, 'dim'), part(`(${fmtUsd(usd)})`, 'warn')])
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
  const usd = typeof e.estimated_cache_write_usd === 'number' ? e.estimated_cache_write_usd : writeUsd(s.ctx, priceNow(s))
  return `the cache expired while the session was closed. The first message will re-write ${fmtCount(s.ctx)} tokens, about ${fmtUsd(usd)}.`
}

/**
 * Where the engine keeps a session's transcript: under `projects/`, in a directory named after the
 * session's start directory with every character but a letter or a digit turned into `-` (measured on
 * 2.1.280).
 */
export function transcriptPath(configDir: string, cwd: string, sid: string): string {
  return `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sid}.jsonl`
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
  s.renew = null
}

function stateLine(s: State, now: number): string {
  if (s.compacted) return 'reset by compaction, waiting for the first turn'
  if (!s.lastRequestAt) return 'no request yet this session'
  if (isCold(s, now)) return `COLD, last request ${fmtDuration(now - s.lastRequestAt)} ago`
  return `warm, ${fmtDuration(s.lastRequestAt + TTL_MS - now)} left`
}

function warmLine(s: State, now: number): string {
  const always = s.always ? ' (always)' : ''
  if (hasWindow(s)) return `on, ${statusText(s, now) ?? ''}${always}`
  if (s.stopped) return `stopped, ${s.stopped}${always}`
  if (s.renew) return `off, ${fmtDuration(s.renew.window)} again at your next message${always}`
  if (s.always) return `off until the next session start or /clear, which start the endless loop again (always)`
  return `off (/cache-warm arms it for ${fmtDuration(DEFAULT_WINDOW_MS)})`
}

function breakEvenLine(s: State): string | null {
  const pings = breakEvenPings(priceNow(s))
  if (pings == null || s.ctx <= 0) return null
  return `up to ${pings} pings at the read rate cost one cold write, about ${fmtDuration(pings * s.every)} of idle at one ping per ${fmtDuration(s.every)}`
}

/** The /cache-status card. */
export function card(s: State, now: number): string {
  const price = priceNow(s)
  const paid = s.coldWrites.reduce((sum, w) => sum + (w.usd ?? 0), 0)
  const count = s.coldWrites.length
  const breakEven = breakEvenLine(s)
  const fast = s.fast && hasFastRate(s.model) ? ' · fast mode rates (the fastMode setting)' : ''
  return [
    `${s.model ?? 'model not seen yet'}${fast}`,
    `state       ${stateLine(s, now)}`,
    `context     ${fmtCount(s.ctx)} tokens`,
    `cold cost   ${fmtUsd(writeUsd(s.ctx, price))} to re-write it (warm turn ${fmtUsd(readUsd(s.ctx, price))})`,
    `keep warm   ${warmLine(s, now)}`,
    ...(breakEven ? [`break-even  ${breakEven}`] : []),
    `session     ${count} cold write${count === 1 ? '' : 's'} paid, ${fmtUsd(paid)}`,
  ].join('\n')
}
