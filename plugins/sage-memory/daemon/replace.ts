import type { Memory, RememberInput } from '../hooks/shared/model.ts'
import { MAX_NOTE_CHARS } from '../hooks/shared/model.ts'
import { refused } from './errors.ts'
import { namesOf } from '../hooks/shared/names.ts'
import type { Op } from './op.ts'
import { syncEdges } from './graph.ts'
import { remember } from './remember.ts'
import { audit, readMemory, selectMemories, sql, writeMemory } from './rows.ts'
import { checkedText } from './rules.ts'

/**
 * Replacing one memory with shorter ones: the rewrite of a memory written before memories held at
 * most `MAX_NOTE_CHARS` characters. The daemon checks the memory is the one the writer read, that
 * every part fits, and that every name of the old text (`namesOf`: a token of 3 or more characters
 * with a digit, `_`, `.`, `/`, an inner `-` or an inner capital, so a path, an identifier, a
 * version, a date or a number of 3 or more digits) is in some part; then it writes the parts with
 * the old memory's fields and relations, each part naming the old memory in `supersedes`, all in
 * the caller's one transaction, so a second writer of the same memory finds it superseded and
 * stops. A recover of the old id answers the first part, as for any superseded memory; the old
 * text stays in the store.
 */

export type ReplaceRequest = { id: string; revision: number; texts: readonly string[]; sessionId?: string }
export type ReplaceResult = { replaced: string; parts: Memory[] }

/** The most memories one memory is split into. */
export const MAX_PARTS = 40

/** A memory whose rewrite failed this many times is left as it is and handed out no more. */
export const MAX_SHORTEN_TRIES = 3

const LONG = `
  SELECT id, data FROM memories
  WHERE status IN ('active', 'stale') AND kind != 'memory_review' AND length(text) > ?
  ORDER BY importance DESC, id`

const FAILED = `SELECT memory_id AS id, COUNT(*) AS n FROM audit_log WHERE action = 'memory.shorten_failed' GROUP BY memory_id`

/** How many times each memory's rewrite failed, read in one scan of the log. */
function failures(op: Op): Map<string, number> {
  const rows = sql(op.store.db, FAILED).all() as Array<{ id: string; n: number }>
  return new Map(rows.map(row => [row.id, row.n]))
}

/**
 * The live memories of a store whose text is longer than a memory may now hold, weightiest first,
 * without those `skip` names (another window holds them) and those whose rewrite failed
 * `MAX_SHORTEN_TRIES` times.
 */
export function longMemories(op: Op, limit: number, skip: (id: string) => boolean = () => false): Memory[] {
  const failed = failures(op)
  return selectMemories(op.store.db, LONG, MAX_NOTE_CHARS)
    .filter(memory => (failed.get(memory.id) ?? 0) < MAX_SHORTEN_TRIES && !skip(memory.id))
    .slice(0, limit)
}

/** Records a failed rewrite of a memory, with what the job model's answer lacked. */
export function shortenFailed(op: Op, id: string, reason: string, sessionId?: string): void {
  if (readMemory(op.store.db, id) === undefined) throw refused(`${id} is not a memory of this store`)
  audit(op.store, op.now, 'memory.shorten_failed', { memoryId: id, sessionId, detail: { reason: reason.slice(0, 500) } })
}

/** The old memory's fields a part carries, so it is found, reminded and kept as the old one was. */
function inputOf(old: Memory, text: string): RememberInput {
  return {
    text,
    scope: old.scope,
    kind: old.kind,
    persistence: old.persistence,
    contextPolicy: old.contextPolicy,
    tags: old.tags,
    audience: old.audience,
    importance: old.importance,
    confidence: old.confidence,
    freshness: old.freshness,
    anchors: old.anchors,
    sources: old.sources,
    ownerSessionId: old.ownerSessionId,
    expiresAt: old.expiresAt,
    supersedes: [old.id],
    contradicts: old.contradicts,
    related: old.related,
    distinct: true,
  }
}

/** One part written; a part of a stale memory stays stale, unless it joined a live memory of the same text. */
function writtenPart(op: Op, old: Memory, text: string): Memory {
  const result = remember(op, inputOf(old, text))
  if (!('memory' in result)) throw refused(`a part of ${old.id} was not written: ${text}`)
  if (old.status !== 'stale' || result.outcome !== 'added') return result.memory
  const stale: Memory = { ...result.memory, status: 'stale', staleReason: old.staleReason }
  writeMemory(op.store.db, stale)
  syncEdges(op.store.db, stale, op.now)
  return stale
}

/** The memory to replace, as the writer read it; anything else is refused. */
function current(op: Op, request: ReplaceRequest): Memory {
  const old = readMemory(op.store.db, request.id)
  if (old === undefined || (old.status !== 'active' && old.status !== 'stale')) throw refused(`${request.id} is not a live memory`)
  if (old.revision !== request.revision) throw refused(`${request.id} changed since it was read (revision ${old.revision}, not ${request.revision})`)
  return old
}

/** The parts' texts, each within the limit, with every name of the old text kept in one of them. */
function checkedParts(old: Memory, texts: readonly string[]): string[] {
  if (!Array.isArray(texts) || texts.length === 0) throw refused('texts must hold at least one text')
  if (texts.length > MAX_PARTS) throw refused(`a memory is split into at most ${MAX_PARTS} memories`)
  const parts = texts.map(checkedText)
  const kept = new Set(parts.flatMap(namesOf))
  const lost = namesOf(old.text).filter(name => !kept.has(name))
  if (lost.length > 0) throw refused(`the parts leave out ${lost.join(', ')} of ${old.id}`)
  return parts
}

/** Writes the parts, the first of which supersedes the old memory; runs inside the caller's transaction. */
export function replaceMemory(op: Op, request: ReplaceRequest): ReplaceResult {
  const old = current(op, request)
  const parts = checkedParts(old, request.texts).map(text => writtenPart(op, old, text))
  audit(op.store, op.now, 'memory.replaced', { memoryId: old.id, sessionId: request.sessionId, detail: { parts: parts.map(part => part.id) } })
  return { replaced: old.id, parts }
}
