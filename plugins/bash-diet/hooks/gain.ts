/**
 * The saving over time: one record per shrunk result, kept in one file per session and day, and the
 * reports `/bash-diet gain` draws from them.
 */

import { charsText, fmtTokens, savingText } from './text.ts'

/** One shrunk result: when, in which project, which command family, and its size before and after. */
export type GainRecord = { at: number; project: string; family: string; raw: number; shown: number }

/** How long the records are kept. */
export const RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

const pad = (n: number): string => String(n).padStart(2, '0')

/** The local calendar day of a time: `2026-09-25`. */
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The file one session's records of one day go in. */
export const gainFileName = (at: number, sessionId: string): string => `${dayOf(at)}-${sessionId}.jsonl`

/** The gain files older than the retention, by the day in their name. */
export function staleGainFiles(names: string[], now: number): string[] {
  const oldest = dayOf(now - RETENTION_DAYS * DAY_MS)
  return names.filter(n => /^\d{4}-\d\d-\d\d-.+\.jsonl$/.test(n) && n.slice(0, 10) < oldest)
}

const isRecord = (v: unknown): v is GainRecord => {
  const r = v as Partial<GainRecord> | null
  return typeof r?.at === 'number' && typeof r.project === 'string' && typeof r.family === 'string' && typeof r.raw === 'number' && typeof r.shown === 'number'
}

/** The records of a file's lines, and how many lines were not a record. */
export function recordsOf(text: string): { records: GainRecord[]; bad: number } {
  const records: GainRecord[] = []
  let bad = 0
  for (const line of text.split('\n').filter(l => l.trim() !== '')) {
    try {
      const v: unknown = JSON.parse(line)
      if (isRecord(v)) records.push(v)
      else bad += 1
    } catch {
      bad += 1
    }
  }
  return { records, bad }
}

export const linesOfRecords = (records: GainRecord[]): string => records.map(r => JSON.stringify(r)).join('\n')

// -------------------------------------------------------------------------------------------- reports

type Total = { calls: number; raw: number; shown: number }

function totalOf(records: GainRecord[]): Total {
  return records.reduce((t, r) => ({ calls: t.calls + 1, raw: t.raw + r.raw, shown: t.shown + r.shown }), { calls: 0, raw: 0, shown: 0 })
}

/** `42 results · 164k → 71k chars (−57%) · ~23k tokens estimated` */
const totalText = (t: Total): string => `${t.calls} result${t.calls === 1 ? '' : 's'} · ${savingText(t.raw, t.shown)}`

/** Records grouped by a key, the largest saving first. */
function grouped(records: GainRecord[], key: (r: GainRecord) => string): [string, Total][] {
  const groups = new Map<string, GainRecord[]>()
  for (const r of records) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
  return [...groups].map(([k, rs]): [string, Total] => [k, totalOf(rs)]).sort((a, b) => (b[1].raw - b[1].shown) - (a[1].raw - a[1].shown))
}

const NONE = 'no Bash result shrunk in the last 90 days'

/** `/bash-diet gain`: the total, then the command families that saved most. */
export function summaryText(records: GainRecord[]): string {
  if (records.length === 0) return NONE
  const first = dayOf(Math.min(...records.map(r => r.at)))
  const top = grouped(records, r => r.family).slice(0, 10)
  const width = Math.max(...top.map(([k]) => k.length))
  return [`since ${first}: ${totalText(totalOf(records))}`, 'top commands:', ...top.map(([k, t]) => `  ${k.padEnd(width)}  ${totalText(t)}`)].join('\n')
}

/** `/bash-diet gain project`: the saving per project. */
export function projectText(records: GainRecord[]): string {
  if (records.length === 0) return NONE
  const rows = grouped(records, r => r.project)
  const width = Math.max(...rows.map(([k]) => k.length))
  return rows.map(([k, t]) => `${k.padEnd(width)}  ${totalText(t)}`).join('\n')
}

/** The last `days` days, oldest first, each with its total. */
function lastDays(records: GainRecord[], now: number, days: number): [string, Total][] {
  const byDay = new Map(grouped(records, r => dayOf(r.at)))
  return Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY_MS)).map(d => [d, byDay.get(d) ?? { calls: 0, raw: 0, shown: 0 }])
}

/** `/bash-diet gain daily`: one row per day of the last two weeks. */
export function dailyText(records: GainRecord[], now: number, days = 14): string {
  return lastDays(records, now, days).map(([d, t]) => (t.calls === 0 ? `${d}  -` : `${d}  ${totalText(t)}`)).join('\n')
}

/** `/bash-diet gain graph`: the characters saved per day as bars. */
export function graphText(records: GainRecord[], now: number, days = 14, width = 40): string {
  const rows = lastDays(records, now, days).map(([d, t]): [string, number] => [d.slice(5), t.raw - t.shown])
  const max = Math.max(1, ...rows.map(([, n]) => n))
  return rows.map(([d, n]) => `${d} ${'█'.repeat(Math.round((n / max) * width)).padEnd(width)} ${n === 0 ? '' : `${fmtTokens(n)} chars`}`.trimEnd()).join('\n')
}

/** `/bash-diet gain history`: the newest results, one line each. */
export function historyText(records: GainRecord[], count = 20): string {
  if (records.length === 0) return NONE
  const newest = [...records].sort((a, b) => b.at - a.at).slice(0, count)
  return newest.map(r => {
    const d = new Date(r.at)
    return `${dayOf(r.at).slice(5)} ${pad(d.getHours())}:${pad(d.getMinutes())}  ${r.family}  ${charsText(r.raw, r.shown)}  ${r.project}`
  }).join('\n')
}

/** The report a `gain` argument asks for, or undefined for an unknown one. */
export function gainReport(view: string, records: GainRecord[], now: number): string | undefined {
  const views: Record<string, () => string> = {
    '': () => summaryText(records),
    project: () => projectText(records),
    daily: () => dailyText(records, now),
    graph: () => graphText(records, now),
    history: () => historyText(records),
  }
  return views[view]?.()
}
