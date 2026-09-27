import type { Memory, Scope } from '../hooks/shared/model.ts'
import { conflict, refused } from './errors.ts'
import { clearReferences, dropEdges, edgeCount } from './graph.ts'
import { mustRead, type Op } from './op.ts'
import { audit, selectMemories, writeMemory } from './rows.ts'

/**
 * Removing memories. A removed memory stays as a tombstone (`deleted`), its relationships and
 * edges cleared and its id taken out of every memory that named it, so `recover` can bring it back.
 */

/** Makes `memory` a tombstone; answers how many of its edges were removed. */
export function tombstone(op: Op, memory: Memory, neverRemind = false): number {
  const removed = edgeCount(op.store.db, memory.id)
  const next: Memory = {
    ...memory,
    status: 'deleted',
    contextPolicy: neverRemind ? 'never' : memory.contextPolicy,
    supersedes: undefined,
    contradicts: undefined,
    supersededBy: undefined,
    revision: memory.revision + 1,
    updatedAt: op.now,
  }
  writeMemory(op.store.db, next)
  clearReferences(op.store.db, memory.id, op.now)
  dropEdges(op.store.db, memory.id)
  return removed
}

/**
 * How a delete was allowed: `force` is the caller's explicit authorization and the only way past
 * `permanent`; `review` is a resolved review, which a permanent memory refuses.
 */
export type DeleteGrant = { force?: boolean; review?: boolean }

export function checkGrant(memory: Memory, grant: DeleteGrant): void {
  if (grant.force === true) return
  if (memory.persistence === 'permanent') throw conflict(`${memory.id} is permanent; only force deletes it, and the force is recorded in the audit log`)
  if (grant.review !== true) throw refused(`deleting ${memory.id} needs force, which is recorded in the audit log`)
}

export type DeleteRequest = DeleteGrant & { id: string; reason: string; neverRemind?: boolean; sessionId?: string }

/** Deletes one memory; answers false when it was a tombstone already. */
export function deleteMemory(op: Op, request: DeleteRequest): boolean {
  const memory = mustRead(op, request.id)
  if (memory.status === 'deleted') return false
  checkGrant(memory, request)
  const removedEdges = tombstone(op, memory, request.neverRemind === true)
  const detail = { reason: request.reason, force: request.force === true, removedEdges, contextPolicy: request.neverRemind === true ? 'never' : memory.contextPolicy }
  audit(op.store, op.now, 'memory.deleted', { memoryId: memory.id, sessionId: request.sessionId, detail })
  return true
}

const MIN_FORGET_CHARS = 3

/** Whether a lowercased query is part of a memory's id, text, tags or anchor strings. */
export function matchesForget(memory: Memory, query: string): boolean {
  const anchorStrings = memory.anchors.flatMap(anchor => [anchor.path, anchor.symbol, anchor.command, anchor.role])
  const searchable = [memory.id, memory.text, ...memory.tags, ...anchorStrings].filter(value => value !== undefined)
  return searchable.join(' ').toLowerCase().includes(query)
}

const IN_SCOPE = `
  SELECT id, data FROM memories
  WHERE status != 'deleted' AND scope = ? AND (? IS NULL OR owner_session_id = ?)
  ORDER BY created_at`

export type ForgetRequest = { query: string; scope: Scope; force?: boolean; sessionId?: string }
export type Forgotten = { removed: string[]; skippedPermanent: string[] }

/**
 * Deletes every memory of one scope whose id, text, tags or anchors hold the query. A permanent
 * memory is skipped. In the session scope only the caller's own session memories match.
 */
export function forget(op: Op, request: ForgetRequest): Forgotten {
  const query = request.query.trim().toLowerCase()
  if (query.length < MIN_FORGET_CHARS) throw refused(`the query is under ${MIN_FORGET_CHARS} characters; a shorter one matches nearly every memory, so delete by id instead`)
  if (request.force !== true) throw refused('forget deletes every match at once, so it needs force, which is recorded in the audit log')
  if (request.scope === 'session' && request.sessionId === undefined) throw refused("forgetting session memories needs the caller's session")
  const owner = request.scope === 'session' ? (request.sessionId ?? null) : null
  const matched = selectMemories(op.store.db, IN_SCOPE, request.scope, owner, owner).filter(memory => matchesForget(memory, query))
  const result: Forgotten = { removed: [], skippedPermanent: [] }
  for (const memory of matched) {
    if (memory.persistence === 'permanent') {
      result.skippedPermanent.push(memory.id)
      continue
    }
    tombstone(op, memory)
    result.removed.push(memory.id)
  }
  audit(op.store, op.now, 'memory.forgotten', { sessionId: request.sessionId, detail: { query: request.query, scope: request.scope, ...result } })
  return result
}

const ALL_LIVE = "SELECT id, data FROM memories WHERE status != 'deleted' AND (? IS NULL OR scope = ?) ORDER BY created_at"

export type Cleared = { cleared: number; skippedPermanent: string[] }

/** Deletes every memory of the store, or of one scope in it, but the permanent ones. */
export function clear(op: Op, request: { scope?: Scope; force?: boolean }): Cleared {
  if (request.force !== true) throw refused('clear deletes every memory in its reach, so it needs force, which is recorded in the audit log')
  const scope = request.scope ?? null
  const result: Cleared = { cleared: 0, skippedPermanent: [] }
  for (const memory of selectMemories(op.store.db, ALL_LIVE, scope, scope)) {
    if (memory.persistence === 'permanent') {
      result.skippedPermanent.push(memory.id)
      continue
    }
    tombstone(op, memory)
    result.cleared++
  }
  audit(op.store, op.now, 'memory.cleared', { detail: { scope: request.scope ?? 'all', ...result } })
  return result
}
