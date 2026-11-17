/**
 * The record days of a memory: the dates its text holds that fall within a day of a date the record
 * keeps in its own field (created, updated, verified, reminded, used). The reminder shows those
 * fields, so the text must not repeat them. Time zones move the day by one, so a date a day before
 * or after counts too; every other date is part of the fact. Shared by the daemon,
 * which enforces the rewrite, and the hooks, which name the days to the job model.
 */

const DAY_MS = 86_400_000

/** A date in the text: ISO `2026-11-16`, or day first `16.11.2026` and `16/11/2026`. */
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g

/** The UTC midnight of a date the text writes, or undefined for one that is no calendar day. */
function dayOf(match: RegExpMatchArray): number | undefined {
  const [year, month, day] = match[1] !== undefined ? [match[1], match[2], match[3]] : [match[6], match[5], match[4]]
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const back = new Date(at)
  return back.getUTCDate() === Number(day) && back.getUTCMonth() === Number(month) - 1 ? at : undefined
}

/** The dates a memory's record keeps in its own fields; the text must not repeat any of them. */
export type RecordDates = { text: string; createdAt: string; updatedAt?: string; lastVerifiedAt?: string; lastAccessedAt?: string; lastUsedAt?: string }

function recordDays(memory: RecordDates): number[] {
  return [memory.createdAt, memory.updatedAt, memory.lastVerifiedAt, memory.lastAccessedAt, memory.lastUsedAt]
    .map(at => (at === undefined ? NaN : Date.parse(at.slice(0, 10))))
    .filter(day => !Number.isNaN(day))
}

/** The dates of `text` within a day of a date the record keeps, as the text writes them, lower case. */
export function writeDays(memory: RecordDates): string[] {
  const kept = recordDays(memory)
  const found = new Set<string>()
  for (const match of memory.text.matchAll(DATE)) {
    const day = dayOf(match)
    if (day !== undefined && kept.some(at => Math.abs(day - at) <= DAY_MS)) found.add(match[0].toLowerCase())
  }
  return [...found]
}
