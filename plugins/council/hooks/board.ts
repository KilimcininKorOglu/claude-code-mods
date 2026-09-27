/** A council run as the person sees it: the sidebar section, the one log line, and the /council status. */

/** How a member is asked: a fork of the session, a completion with the conversation as text, or gemini-core. */
export type Via = 'fork' | 'complete' | 'gemini'

export type SeatState = 'running' | 'answered' | 'failed' | 'skipped'

/** One member's place in a run. */
export type Seat = { label: string; via: Via; state: SeatState; ms?: number; inTokens?: number; outTokens?: number; why?: string; freeTier?: boolean }

export type ChairState = 'waiting' | 'running' | 'answered' | 'failed'

export type Chair = { label: string; via: 'fork' | 'complete'; state: ChairState; ms?: number; why?: string }

/** A run from start to verdict; `endedAt` is set once the chair has answered or failed. */
export type Run = { id: number; question: string; startedAt: number; seats: Seat[]; chair: Chair; verdict?: string; endedAt?: number }

/** A sidebar line, as the sidebar contract spells it; kept here so this file stays free of `$`. */
export type Kind = 'ok' | 'warn' | 'error' | 'dim' | 'info'
export type Part = { text: string; kind?: Kind }
export type Line = { text: string; kind?: Kind; parts?: readonly Part[] }

function line(parts: readonly Part[]): Line {
  return { text: parts.map(p => p.text).join(''), parts }
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

function secs(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}

function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

const SEAT_KIND: Record<SeatState, Kind> = { running: 'warn', answered: 'ok', failed: 'error', skipped: 'dim' }

/** What follows a seat's state word: the time and tokens of an answer, or why there is none. */
function seatTail(s: Seat): string {
  if (s.state === 'answered') return ` ${secs(s.ms ?? 0)} · ${tokens(s.inTokens ?? 0)} in, ${tokens(s.outTokens ?? 0)} out${s.freeTier === true ? ' · free tier' : ''}`
  return s.why === undefined ? '' : `: ${s.why}`
}

/**
 * The model's colour by family, as session-watch and subagent-ledger give it: opus red, fable yellow,
 * sonnet green, haiku faint, and the whole Gemini family blue.
 */
function modelTone(label: string): Kind | undefined {
  const families: [RegExp, Kind][] = [[/opus/i, 'error'], [/fable/i, 'warn'], [/sonnet/i, 'ok'], [/haiku/i, 'dim'], [/^(?:gemini|gemma)-/i, 'info']]
  return families.find(([family]) => family.test(label))?.[1]
}

/** A model's label as a part, coloured by its family. */
function modelPart(label: string): Part {
  const kind = modelTone(label)
  return kind === undefined ? { text: label } : { text: label, kind }
}

function seatLine(s: Seat): Line {
  return line([modelPart(s.label), { text: ` · ${s.via} · ` }, { text: s.state, kind: SEAT_KIND[s.state] }, { text: seatTail(s) }])
}

const CHAIR_WORD: Record<ChairState, { text: string; kind: Kind }> = {
  waiting: { text: 'waiting', kind: 'dim' },
  running: { text: 'writing', kind: 'warn' },
  answered: { text: 'done', kind: 'ok' },
  failed: { text: 'failed', kind: 'error' },
}

function chairLine(c: Chair): Line {
  const word = CHAIR_WORD[c.state]
  const tail = c.state === 'answered' ? ` ${secs(c.ms ?? 0)}` : c.why === undefined ? '' : `: ${c.why}`
  return line([{ text: 'chair · ' }, modelPart(c.label), { text: ` · ${c.via} · ` }, word, { text: tail }])
}

function headLine(run: Run, now: number): Line {
  const state = run.endedAt === undefined ? { text: `running ${secs(now - run.startedAt)}`, kind: 'warn' as const } : { text: `done in ${secs(run.endedAt - run.startedAt)}`, kind: 'ok' as const }
  return line([{ text: cut(run.question, 60), kind: 'dim' }, { text: ' · ' }, state])
}

/** The verdict's first words as plain text: markdown marks and a leading "verdict" title left out. */
function plainVerdict(text: string): string {
  return text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().replace(/^(?:council )?verdict:?\s*/i, '')
}

/** The section's lines: the question, each member, the chair, and the verdict's first words once there is one. */
export function runLines(run: Run, now: number): Line[] {
  const verdict = run.verdict === undefined ? [] : [{ text: `verdict: ${cut(plainVerdict(run.verdict), 80)}` }]
  return [headLine(run, now), ...run.seats.map(seatLine), chairLine(run.chair), ...verdict]
}

function answeredCount(run: Run): number {
  return run.seats.filter(s => s.state === 'answered').length
}

/** One line for a closed sidebar, and the last run in the status. */
export function summaryText(run: Run): string {
  const took = run.endedAt === undefined ? 'still running' : `in ${secs(run.endedAt - run.startedAt)}`
  const chair = run.chair.state === 'answered' ? 'the chair wrote the verdict' : `the chair wrote none: ${run.chair.why ?? 'no member answered'}`
  return `${answeredCount(run)} of ${run.seats.length} members answered ${took}; ${chair}`
}

/** A member in the status: its label, and why a run would skip it. */
export type StatusMember = { label: string; skipped?: string }

export function statusText(enabled: boolean, members: readonly StatusMember[], chair: string, last: string | undefined): string {
  const head = enabled ? 'on: the model can call the council when it is stuck' : 'off: the model cannot call the council; /council <question> still runs'
  const names = members.map(m => (m.skipped === undefined ? m.label : `${m.label} (skipped: ${m.skipped})`)).join(', ')
  return [head, `members: ${names}`, `chair: ${chair}`, ...(last === undefined ? [] : [`last: ${last}`])].join('\n')
}
