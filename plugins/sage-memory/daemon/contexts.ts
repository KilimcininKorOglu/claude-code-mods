import type { DatabaseSync } from 'node:sqlite'
import type { Op } from './op.ts'
import { sql } from './rows.ts'

/**
 * Context epochs: which memories each loop of a session (the main loop, or a subagent by its id)
 * was already reminded of since its context last started over. A compaction or `/clear` starts a
 * new epoch, so a memory goes to one context once. Kept in the project's store for the memories
 * of both stores; a memory id is unique across them.
 */

const EPOCH = 'SELECT epoch FROM contexts WHERE session_id = ? AND loop_id = ?'

const NEXT_EPOCH = `
  INSERT INTO contexts (session_id, loop_id, epoch, updated_at) VALUES (?, ?, 1, ?)
  ON CONFLICT (session_id, loop_id) DO UPDATE SET epoch = epoch + 1, updated_at = excluded.updated_at
  RETURNING epoch`

const DROP_EARLIER = 'DELETE FROM reminders WHERE session_id = ? AND loop_id = ? AND epoch < ?'

const REMINDED = 'SELECT memory_id FROM reminders WHERE session_id = ? AND loop_id = ? AND epoch = ?'

const MARK = 'INSERT OR IGNORE INTO reminders (session_id, loop_id, epoch, memory_id, trigger, at) VALUES (?, ?, ?, ?, ?, ?)'

/** A loop's current epoch; one that never started over is at 0. */
export function epochOf(db: DatabaseSync, sessionId: string, loop: string): number {
  const row = sql(db, EPOCH).get(sessionId, loop) as { epoch: number } | undefined
  return row?.epoch ?? 0
}

/** Starts a loop's context over, and forgets what the earlier epochs were reminded of. */
export function nextEpoch(op: Op, sessionId: string, loop: string): number {
  const { epoch } = sql(op.store.db, NEXT_EPOCH).get(sessionId, loop, op.now) as { epoch: number }
  sql(op.store.db, DROP_EARLIER).run(sessionId, loop, epoch)
  return epoch
}

/** The memories this loop's current context was already reminded of; none without a session and a loop. */
export function remindedIn(db: DatabaseSync, sessionId: string | undefined, loop: string | undefined): Set<string> {
  if (sessionId === undefined || loop === undefined) return new Set()
  const rows = sql(db, REMINDED).all(sessionId, loop, epochOf(db, sessionId, loop)) as Array<{ memory_id: string }>
  return new Set(rows.map(row => row.memory_id))
}

/** Records that the loop's current context was reminded of these memories. */
export function markReminded(op: Op, reminder: { sessionId: string; loop: string; ids: readonly string[]; trigger: string }): void {
  const epoch = epochOf(op.store.db, reminder.sessionId, reminder.loop)
  for (const id of new Set(reminder.ids)) sql(op.store.db, MARK).run(reminder.sessionId, reminder.loop, epoch, id, reminder.trigger, op.now)
}
