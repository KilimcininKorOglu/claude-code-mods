function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** `21:58` for a message sent today, `17.09.2026 21:58` for an older one, in local time. */
export function formatSent(at: Date, now: Date): string {
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (isSameDay(at, now)) return clock
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ${clock}`
}

export interface TranscriptIndex {
  /** The time of each user and assistant row, in epoch milliseconds, by the row's uuid. */
  times: Map<string, number>
  /** Lines that are not JSON; a transcript being written can end in a partial one. */
  broken: number
}

const MESSAGE_TYPES = new Set(['user', 'assistant'])

function rowTime(row: unknown): [string, number] | null {
  if (typeof row !== 'object' || row === null) return null
  const { type, uuid, timestamp } = row as Record<string, unknown>
  if (!MESSAGE_TYPES.has(String(type)) || typeof uuid !== 'string' || typeof timestamp !== 'string') return null
  const at = Date.parse(timestamp)
  return Number.isNaN(at) ? null : [uuid, at]
}

/** Maps the uuid of every user and assistant row of a session transcript (JSONL) to its timestamp. */
export function indexTranscript(jsonl: string): TranscriptIndex {
  const times = new Map<string, number>()
  let broken = 0
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      broken++
      continue
    }
    const entry = rowTime(row)
    if (entry) times.set(entry[0], entry[1])
  }
  return { times, broken }
}
