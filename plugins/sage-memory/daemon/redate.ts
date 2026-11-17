import type { Memory } from '../hooks/shared/model.ts'
import { attributionsOf, personWordsIn } from '../hooks/shared/attribution.ts'
import { writeDays, type RecordDates } from '../hooks/shared/days.ts'
import { namesOf } from '../hooks/shared/names.ts'
import { refused } from './errors.ts'
import type { Op } from './op.ts'
import { audit, readMemory, selectMemories, sql } from './rows.ts'
import { checkedText } from './rules.ts'
import { updateMemory } from './update.ts'

/**
 * Taking the write day out of a memory's text. Writers put the day a fact was learned or decided
 * into the text, because no reminder showed the record's dates; the record keeps that day, so the
 * text need not. `writeDays` names those dates; every other date is part of the fact and stays. The job model
 * proposes the new text, and the daemon holds it to the rule: every name of the old text but the
 * write days stays, no name is added, and no write day is left.
 */

export type RedateRequest = { id: string; revision: number; text: string; sessionId?: string }

/** A memory whose rewrite failed this many times under one plugin version waits for the next version. */
export const MAX_REDATE_TRIES = 3

const LIVE = `
  SELECT id, data FROM memories
  WHERE status IN ('active', 'stale') AND kind != 'memory_review'
  ORDER BY importance DESC, id`

/** A memory whose attribution phrases the job model judged part of the fact ("Go refuses ..."): it keeps its text and is not handed out again. */
const KEPT = "SELECT DISTINCT memory_id AS id FROM audit_log WHERE action = 'memory.attribution_kept'"

/** Whether a memory's text holds a record day, or a phrase naming who decided it that was not judged part of the fact. */
function needsRewrite(memory: Memory, kept: ReadonlySet<string>): boolean {
  return writeDays(memory).length > 0 || (attributionsOf(memory.text).length > 0 && !kept.has(memory.id))
}

const FAILED = `
  SELECT memory_id AS id, COUNT(*) AS n FROM audit_log
  WHERE action = 'memory.redate_failed' AND json_extract(detail, '$.version') = ?
  GROUP BY memory_id`

function failures(op: Op, version: string): Map<string, number> {
  const rows = sql(op.store.db, FAILED).all(version) as Array<{ id: string; n: number }>
  return new Map(rows.map(row => [row.id, row.n]))
}

/** The live memories whose text holds a record day or names who decided it, weightiest first, without those `skip` names and those that failed their tries under `version`. */
export function datedMemories(op: Op, limit: number, version: string, skip: (id: string) => boolean = () => false): Memory[] {
  const failed = failures(op, version)
  const kept = new Set((sql(op.store.db, KEPT).all() as Array<{ id: string }>).map(row => row.id))
  return selectMemories(op.store.db, LIVE)
    .filter(memory => needsRewrite(memory, kept) && (failed.get(memory.id) ?? 0) < MAX_REDATE_TRIES && !skip(memory.id))
    .slice(0, limit)
}

/** Records a failed rewrite under `version`, with what the answer lacked. */
export function redateFailed(op: Op, request: { id: string; reason: string; version: string; sessionId?: string }): void {
  if (readMemory(op.store.db, request.id) === undefined) throw refused(`${request.id} is not a memory of this store`)
  audit(op.store, op.now, 'memory.redate_failed', { memoryId: request.id, sessionId: request.sessionId, detail: { reason: request.reason.slice(0, 500), version: request.version } })
}

/** What is wrong with `text` as the old memory without its write days, or undefined when nothing is. */
export function redateProblem(old: RecordDates, text: string): string | undefined {
  const days = new Set(writeDays(old))
  const names = new Set(namesOf(text))
  const lost = namesOf(old.text).filter(name => !days.has(name) && !names.has(name))
  if (lost.length > 0) return `the text leaves out ${lost.join(', ')}; copy each exactly`
  const before = new Set(namesOf(old.text))
  const added = [...names].filter(name => !before.has(name))
  if (added.length > 0) return `the text adds ${added.join(', ')}, which the old text does not hold`
  const left = [...days].filter(day => names.has(day))
  if (left.length > 0) return `the text still holds ${left.join(', ')}`
  if (text === old.text || attributionsOf(old.text).length === 0) return undefined
  const said = [...attributionsOf(old.text).filter(phrase => text.includes(phrase)), ...personWordsIn(old.text, text)]
  return said.length > 0 ? `the text still names who decided it: ${said.join(', ')}` : undefined
}

/** Rewrites one memory's text without its write days; id, anchors, creation time and links stay. Runs inside the caller's transaction. */
export function redateMemory(op: Op, request: RedateRequest): Memory {
  const old = readMemory(op.store.db, request.id)
  if (old === undefined || (old.status !== 'active' && old.status !== 'stale')) throw refused(`${request.id} is not a live memory`)
  if (old.revision !== request.revision) throw refused(`${request.id} changed since it was read (revision ${old.revision}, not ${request.revision})`)
  const text = checkedText(request.text)
  const problem = redateProblem(old, text)
  if (problem !== undefined) throw refused(problem)
  if (text === old.text) {
    // The job model judged the matched phrases part of the fact; the text stays and is not asked about again.
    audit(op.store, op.now, 'memory.attribution_kept', { memoryId: old.id, sessionId: request.sessionId, detail: { phrases: attributionsOf(old.text) } })
    return old
  }
  const memory = updateMemory(op, { id: old.id, patch: { text }, sessionId: request.sessionId }).memory
  audit(op.store, op.now, 'memory.redated', { memoryId: old.id, sessionId: request.sessionId, detail: { days: writeDays(old) } })
  return memory
}
