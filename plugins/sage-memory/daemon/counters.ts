import type { Op } from './op.ts'
import { audit, sql } from './rows.ts'

/**
 * Usage counters. They live in the record's JSON alone: the revision, `updated_at` (the content's
 * clock that listing and hygiene age by) and the text index stay as they were.
 */

const REMINDED = `
  UPDATE memories SET data = json_set(data,
    '$.reminderCount', COALESCE(json_extract(data, '$.reminderCount'), 0) + 1,
    '$.lastAccessedAt', ?)
  WHERE id = ? AND status != 'deleted'`

const USED = `
  UPDATE memories SET data = json_set(data,
    '$.useCount', COALESCE(json_extract(data, '$.useCount'), 0) + 1,
    '$.lastUsedAt', ?,
    '$.lastAccessedAt', ?)
  WHERE id = ? AND status != 'deleted'`

/**
 * The trigger that sends every active user memory to each context, whatever it asks. It is no
 * relevance decision, so it counts toward no memory's reminders, which the ranking weighs.
 */
export const GLOBAL_TRIGGER = 'global'

/** Counts one memory reminder for each memory a trigger sent to the model; the global rules are only audited. */
export function recordReminder(op: Op, ids: readonly string[], trigger: string, sessionId: string | undefined): void {
  const distinct = [...new Set(ids)]
  if (trigger !== GLOBAL_TRIGGER) for (const id of distinct) sql(op.store.db, REMINDED).run(op.now, id)
  audit(op.store, op.now, 'memory.reminded', { sessionId, detail: { memoryIds: distinct, trigger } })
}

/**
 * Logs the consolidator's verdict on the memories relevance reminded a turn of: which it followed.
 * No counter changes: the verdict is audited alone until it is measured against real turns.
 */
export function recordJudged(op: Op, judged: readonly string[], followed: readonly string[], sessionId: string | undefined): void {
  audit(op.store, op.now, 'memory.judged', { sessionId, detail: { memoryIds: [...new Set(judged)], followed: [...new Set(followed)] } })
}

/** Counts one use for each reminded memory the model's answer drew on. */
export function recordUse(op: Op, ids: readonly string[], source: string, sessionId: string | undefined): void {
  const distinct = [...new Set(ids)]
  for (const id of distinct) sql(op.store.db, USED).run(op.now, op.now, id)
  audit(op.store, op.now, 'memory.used', { sessionId, detail: { memoryIds: distinct, source } })
}
