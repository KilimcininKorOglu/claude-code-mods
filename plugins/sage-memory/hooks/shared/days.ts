/**
 * The write days of a memory: the dates its text holds that fall within a day of its creation, the
 * day it was learned or decided, which the record keeps. Time zones move the day by one, so a date
 * a day before or after counts too; every other date is part of the fact. Shared by the daemon,
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

/** The dates of `text` within a day of `createdAt`, as the text writes them, lower case. */
export function writeDays(memory: { text: string; createdAt: string }): string[] {
  const created = Date.parse(memory.createdAt.slice(0, 10))
  if (Number.isNaN(created)) return []
  const found = new Set<string>()
  for (const match of memory.text.matchAll(DATE)) {
    const day = dayOf(match)
    if (day !== undefined && Math.abs(day - created) <= DAY_MS) found.add(match[0].toLowerCase())
  }
  return [...found]
}
