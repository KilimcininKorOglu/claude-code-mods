import type { SessionRateLimit } from 'claude-code'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The usage percentages that raise a warning, once per limit cycle each. */
export const THRESHOLDS: readonly number[] = [80, 95]

/** Samples kept per limit. At one sample a minute this covers the 24 hour lookback of the 7-day limit. */
const MAX_SAMPLES = 1500

/** A reset time that moves by more than this starts a new cycle. Smaller moves are treated as jitter. */
const RESET_JITTER = 5 * MINUTE

/** A fall in the percentage larger than this starts a new cycle when the limit reports no reset time. */
const PERCENT_JITTER = 0.5

export type Sample = { at: number; percent: number }

/** What limit-watch remembers about one limit during its current cycle. */
export type Track = { resetsAt?: string; samples: Sample[]; warned: number[] }

export type Tracks = Record<string, Track>

/**
 * How one kind of limit is named and measured. `lookback` is the span of recent samples the pace
 * is read from. `minSpan` is the shortest span that gives a pace worth showing. A limit with a
 * `cycle` reads its pace as the average since the cycle began, `resetsAt` minus `cycle`, instead.
 */
export type Profile = { short: string; name: string; lookback: number; minSpan: number; cycle?: number }

const PROFILES: Record<string, Profile> = {
  five_hour: { short: '5h', name: '5-hour limit', lookback: HOUR, minSpan: 10 * MINUTE },
  seven_day: { short: '7d', name: '7-day limit', lookback: DAY, minSpan: DAY, cycle: 7 * DAY },
  spend_limit: { short: 'spend', name: 'Spend limit', lookback: DAY, minSpan: 2 * HOUR },
}

export function profile(kind: string): Profile {
  return PROFILES[kind] ?? { short: kind, name: kind.replaceAll('_', ' '), lookback: DAY, minSpan: 2 * HOUR }
}

/** The time a limit resets, in milliseconds since the epoch, or undefined when the limit reports none. */
export function resetTime(limit: SessionRateLimit): number | undefined {
  if (limit.resetsAt === undefined) return undefined
  const at = Date.parse(limit.resetsAt)
  return Number.isFinite(at) ? at : undefined
}

function isNewCycle(track: Track, limit: SessionRateLimit): boolean {
  const last = track.samples.at(-1)
  if (last !== undefined && limit.percentUsed < last.percent - PERCENT_JITTER) return true
  if (track.resetsAt === undefined || limit.resetsAt === undefined) return false
  return Math.abs(Date.parse(limit.resetsAt) - Date.parse(track.resetsAt)) > RESET_JITTER
}

function recordOne(track: Track | undefined, limit: SessionRateLimit, now: number): Track {
  const current = track === undefined || isNewCycle(track, limit) ? { samples: [], warned: [] } : track
  const oldest = now - profile(limit.kind).lookback
  const kept = current.samples.filter(s => s.at >= oldest).slice(-(MAX_SAMPLES - 1))
  return { resetsAt: limit.resetsAt, samples: [...kept, { at: now, percent: limit.percentUsed }], warned: current.warned }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSample(value: unknown): value is Sample {
  return isRecord(value) && typeof value.at === 'number' && typeof value.percent === 'number'
}

function isTrack(value: unknown): value is Track {
  if (!isRecord(value)) return false
  const resetsAtOk = value.resetsAt === undefined || typeof value.resetsAt === 'string'
  const warnedOk = Array.isArray(value.warned) && value.warned.every(w => typeof w === 'number')
  return resetsAtOk && warnedOk && Array.isArray(value.samples) && value.samples.every(isSample)
}

/**
 * Reads the tracks kept in the store. Nothing stored reads as no tracks.
 * A stored value of another shape returns undefined, so the caller can report it.
 */
export function parseTracks(value: unknown): Tracks | undefined {
  if (value === undefined) return {}
  if (!isRecord(value) || !Object.values(value).every(isTrack)) return undefined
  return value as Tracks
}

/** Adds one sample per reported limit. A limit that is not reported keeps its track unchanged. */
export function record(tracks: Tracks, limits: readonly SessionRateLimit[], now: number): Tracks {
  const next: Tracks = { ...tracks }
  for (const limit of limits) next[limit.kind] = recordOne(tracks[limit.kind], limit, now)
  return next
}

/** A pace in percent per hour, or the span still missing before a pace can be read. */
export type Pace = { perHour: number; span: number } | { missing: number }

/**
 * The least-squares slope of the samples, in percent per millisecond. Every sample weighs in, so one
 * jump of the whole-number percentage at either end does not set the pace alone, as it did when the
 * pace was read from the first and last sample.
 */
function slope(samples: readonly Sample[]): number {
  const meanAt = samples.reduce((a, s) => a + s.at, 0) / samples.length
  const meanPercent = samples.reduce((a, s) => a + s.percent, 0) / samples.length
  let cov = 0
  let variance = 0
  for (const s of samples) {
    cov += (s.at - meanAt) * (s.percent - meanPercent)
    variance += (s.at - meanAt) ** 2
  }
  return cov / variance
}

/** Reads the pace of a limit from the samples of its lookback. */
export function pace(track: Track | undefined, kind: string, now: number): Pace {
  const { lookback, minSpan } = profile(kind)
  const recent = (track?.samples ?? []).filter(s => s.at >= now - lookback)
  const first = recent.at(0)
  const last = recent.at(-1)
  const span = first !== undefined && last !== undefined ? last.at - first.at : 0
  if (first === undefined || last === undefined || span < minSpan) return { missing: minSpan - span }
  return { perHour: slope(recent) * HOUR, span }
}

/**
 * The pace a forecast uses. A limit with a `cycle` and a reset time averages its percentage over
 * the whole cycle so far, nights and idle hours included, because a few busy hours of samples
 * stretched over days put the 7-day limit at 100% days too early (measured: 4% after 2.4 busy hours
 * read as full in 2d 8h). Any other limit reads the pace from its samples.
 */
export function limitPace(limit: SessionRateLimit, track: Track | undefined, now: number): Pace {
  const { cycle, minSpan } = profile(limit.kind)
  const reset = resetTime(limit)
  if (cycle === undefined || reset === undefined) return pace(track, limit.kind, now)
  const span = now - (reset - cycle)
  if (span < minSpan) return { missing: minSpan - span }
  return { perHour: (limit.percentUsed / span) * HOUR, span }
}

export type Forecast =
  | { kind: 'reached' }
  | { kind: 'measuring' }
  | { kind: 'flat' }
  | { kind: 'reset-first' }
  | { kind: 'full-at'; at: number }

/** When the limit reaches 100% at the current pace, if it does before its reset. */
export function forecast(limit: SessionRateLimit, p: Pace, now: number): Forecast {
  if (limit.percentUsed >= 100) return { kind: 'reached' }
  if (!('perHour' in p)) return { kind: 'measuring' }
  if (p.perHour <= 0) return { kind: 'flat' }
  const at = now + ((100 - limit.percentUsed) / p.perHour) * HOUR
  const reset = resetTime(limit)
  if (reset !== undefined && at >= reset) return { kind: 'reset-first' }
  return { kind: 'full-at', at }
}

/**
 * The thresholds a limit passed and has not warned about in this cycle, highest first.
 * The caller logs the first one and marks all of them as warned.
 */
export function newThresholds(track: Track, percent: number): number[] {
  return THRESHOLDS.filter(t => percent >= t && !track.warned.includes(t)).sort((a, b) => b - a)
}

/** Two tracks of one limit belong to one cycle when their reset times differ by no more than the jitter. */
function isSameCycle(a: Track, b: Track): boolean {
  if (a.resetsAt === undefined || b.resetsAt === undefined) return a.resetsAt === b.resetsAt
  return Math.abs(Date.parse(a.resetsAt) - Date.parse(b.resetsAt)) <= RESET_JITTER
}

/**
 * Adds the warnings another session stored to the tracks of this one, per limit and only within one
 * cycle, so a threshold that session already warned about is not warned about here again.
 */
export function mergeWarned(tracks: Tracks, stored: Tracks): Tracks {
  const next: Tracks = { ...tracks }
  for (const [kind, track] of Object.entries(tracks)) {
    const other = stored[kind]
    if (other === undefined || !isSameCycle(track, other)) continue
    next[kind] = { ...track, warned: [...new Set([...track.warned, ...other.warned])] }
  }
  return next
}

export function markWarned(tracks: Tracks, kind: string, levels: readonly number[]): Tracks {
  const track = tracks[kind]
  if (track === undefined || levels.length === 0) return tracks
  return { ...tracks, [kind]: { ...track, warned: [...track.warned, ...levels] } }
}

// Formatting. Nothing below reads the engine or the clock.

export function percentText(percent: number): string {
  return `${Number(percent.toFixed(1))}%`
}

/** A duration as `<1m`, `45m`, `2h 5m` or `5d 11h`. */
export function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A local clock time as `15:00`, with the weekday in front when it is not today. */
export function clockText(at: number, now: number): string {
  const date = new Date(at)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return date.toDateString() === new Date(now).toDateString() ? time : `${WEEKDAYS[date.getDay()]} ${time}`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

const part = (text: string, kind: Tone | undefined): Part => (kind === undefined ? { text } : { text, kind })

/** A line made of parts, its `text` their texts joined. */
const partsLine = (parts: Part[]): Line => ({ text: parts.map(p => p.text).join(''), parts })

/** The colour of one limit: red over the top threshold, yellow over the first, green under both. */
function limitTone(percent: number): Tone {
  if (percent >= (THRESHOLDS[1] ?? 95)) return 'error'
  return percent >= (THRESHOLDS[0] ?? 80) ? 'warn' : 'ok'
}

/** One limit as `5h 23%, reset in 46m`: only the percentage coloured, the reset faint. */
function limitLine(limit: SessionRateLimit, now: number): Line {
  const reset = resetTime(limit)
  const head = [part(`${profile(limit.kind).short} `, undefined), part(percentText(limit.percentUsed), limitTone(limit.percentUsed))]
  return partsLine(reset === undefined ? head : [...head, part(`, reset in ${durationText(reset - now)}`, 'dim')])
}

/**
 * The tail names the limit that fills first, or says why none does: a reached limit red, the time
 * to fill yellow, a pace still being measured faint, and no limit filling green.
 */
function tailLine(limits: readonly SessionRateLimit[], tracks: Tracks, now: number): Line {
  const forecasts = limits.map(l => ({ limit: l, f: forecast(l, limitPace(l, tracks[l.kind], now), now) }))
  const reached = forecasts.find(x => x.f.kind === 'reached')
  if (reached !== undefined) return partsLine([part(`${profile(reached.limit.kind).short} `, undefined), part('limit reached', 'error')])
  const filling = forecasts
    .flatMap(x => (x.f.kind === 'full-at' ? [{ limit: x.limit, at: x.f.at }] : []))
    .sort((a, b) => a.at - b.at)
    .at(0)
  if (filling !== undefined) {
    return partsLine([part(`${profile(filling.limit.kind).short} hits 100% in `, undefined), part(`~${durationText(filling.at - now)}`, 'warn')])
  }
  if (forecasts.every(x => x.f.kind === 'measuring')) return { text: 'measuring the pace', kind: 'dim' }
  return { text: 'no limit fills before its reset', kind: 'ok' }
}

export function statusLine(limits: readonly SessionRateLimit[], tracks: Tracks, now: number): string {
  if (limits.length === 0) return 'no usage limits reported yet'
  return [...limits.map(l => limitLine(l, now).text), tailLine(limits, tracks, now).text].join(' · ')
}

/** The same reading as the status line, one line per limit, for the shared sidebar. */
export function sidebarLines(limits: readonly SessionRateLimit[], tracks: Tracks, now: number): Line[] {
  if (limits.length === 0) return [{ text: 'no usage limits reported yet', kind: 'dim' }]
  return [...limits.map(l => limitLine(l, now)), tailLine(limits, tracks, now)]
}

/** A bar of `width` cells, filled up to the percentage. A percentage above 100 fills the whole bar. */
export function barCells(percent: number, width: number): { filled: string; empty: string } {
  const cells = Math.max(1, width)
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(cells - filled) }
}

/** The bar color for a percentage: green below the first threshold, yellow below the last, red above. */
export function barColor(percent: number): string {
  const [low = 80, high = 95] = THRESHOLDS
  if (percent >= high) return 'red'
  return percent >= low ? 'yellow' : 'green'
}

export function paceText(p: Pace): string {
  if ('perHour' in p) return `pace ${p.perHour >= 0 ? '+' : ''}${p.perHour.toFixed(1)}%/h over the last ${durationText(p.span)}`
  return `pace: measuring, ${durationText(p.missing)} of samples still needed`
}

export function warningText(limit: SessionRateLimit, level: number, now: number): string {
  const reset = resetTime(limit)
  const when = reset === undefined ? '' : `, resets ${clockText(reset, now)} (in ${durationText(reset - now)})`
  return `${profile(limit.kind).name} passed ${level}% (now ${percentText(limit.percentUsed)})${when}`
}
