import type { BackfillFilter, BackfillRecord, BackfillReport, Memory } from '../hooks/shared/model.ts'
import { textKey } from '../hooks/shared/text.ts'
import { conflict } from './errors.ts'
import { syncEdges } from './graph.ts'
import { checkOwner, mustRead, type Op } from './op.ts'
import { audit, readMemory, selectMemories, writeMemory } from './rows.ts'
import { ulid } from './ulid.ts'

/** Bringing memories back: a tombstone in place (`recover`), or as a new memory beside it (`backfill`). */

const MAX_CHAIN = 64

/** The active memory at the end of a `supersededBy` chain, or undefined when the chain breaks or loops. */
function chainHead(op: Op, memory: Memory): Memory | undefined {
  let current = memory
  const seen = new Set([current.id])
  for (let step = 0; step < MAX_CHAIN; step++) {
    if (current.supersededBy === undefined) return current.status === 'active' ? current : undefined
    if (seen.has(current.supersededBy)) return undefined
    seen.add(current.supersededBy)
    const next = readMemory(op.store.db, current.supersededBy)
    if (!next) return undefined
    current = next
  }
  return undefined
}

const SUCCESSORS = `
  SELECT id, data FROM memories
  WHERE status != 'deleted' AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(data, '$.supersedes'), '[]')) WHERE value = ?)`

/** The active head of a live memory that took a tombstone's place (a backfill did). */
function successorHead(op: Op, id: string): Memory | undefined {
  for (const successor of selectMemories(op.store.db, SUCCESSORS, id)) {
    const head = chainHead(op, successor)
    if (head) return head
  }
  return undefined
}

export type Recovered = { memory: Memory; noop: boolean }

/** The active memory an id leads to, recording a no-op. */
function led(op: Op, id: string, head: Memory, why: string): Recovered {
  audit(op.store, op.now, 'memory.recover_noop', { memoryId: id, detail: { activeId: head.id, why } })
  return { memory: head, noop: true }
}

function restored(op: Op, memory: Memory, reason: string, sessionId: string | undefined): Recovered {
  const next: Memory = { ...memory, status: 'active', revision: memory.revision + 1, updatedAt: op.now }
  writeMemory(op.store.db, next)
  syncEdges(op.store.db, next, op.now)
  audit(op.store, op.now, 'memory.recovered', { memoryId: memory.id, sessionId, detail: { reason } })
  return { memory: next, noop: false }
}

/**
 * Restores a memory: an active one answers itself, a superseded one the active head of its chain,
 * a tombstone its backfilled successor or itself made active again. Its context policy stays.
 */
export function recoverMemory(op: Op, request: { id: string; reason?: string; sessionId?: string }): Recovered {
  const memory = mustRead(op, request.id)
  checkOwner(memory, request.sessionId)
  if (memory.status === 'active') return { memory, noop: true }
  if (memory.status === 'superseded') {
    const head = chainHead(op, memory)
    if (!head) throw conflict(`${memory.id} is superseded, but no active memory ends its chain`)
    return led(op, memory.id, head, 'superseded')
  }
  if (memory.status !== 'deleted') throw conflict(`${memory.id} is ${memory.status}, which recover does not change; update its status instead`)
  const successor = successorHead(op, memory.id)
  if (successor) return led(op, memory.id, successor, 'backfilled')
  return restored(op, memory, request.reason ?? 'recovered', request.sessionId)
}

function recordOf(memory: Memory, reason: string): BackfillRecord {
  return { originalId: memory.id, reason, kind: memory.kind, scope: memory.scope, textPreview: memory.text.slice(0, 200), deletedAt: memory.updatedAt }
}

/** One scope, one owner, one text: the same knowledge. */
function knowledgeKey(memory: Memory): string {
  return `${memory.scope}\0${memory.ownerSessionId ?? ''}\0${textKey(memory.text)}`
}

type Scan = { recovered: Set<string>; live: Set<string> }

function scanLive(op: Op): Scan {
  const scan: Scan = { recovered: new Set(), live: new Set() }
  for (const memory of selectMemories(op.store.db, "SELECT id, data FROM memories WHERE status != 'deleted'")) {
    for (const id of memory.supersedes ?? []) scan.recovered.add(id)
    if (memory.status === 'active' || memory.status === 'stale') scan.live.add(knowledgeKey(memory))
  }
  return scan
}

type SkipRule = [reason: string, skips: (memory: Memory, filter: BackfillFilter, scan: Scan) => boolean]

/** The reasons a tombstone is left alone, checked in order. */
const SKIP_RULES: readonly SkipRule[] = [
  ['filter_ids', (memory, filter) => filter.ids !== undefined && !filter.ids.includes(memory.id)],
  ['already_recovered', (memory, _filter, scan) => scan.recovered.has(memory.id)],
  ['filter_kinds', (memory, filter) => filter.kinds !== undefined && !filter.kinds.includes(memory.kind)],
  ['filter_scopes', (memory, filter) => filter.scopes !== undefined && !filter.scopes.includes(memory.scope)],
  ['filter_updatedAfter', (memory, filter) => filter.updatedAfter !== undefined && memory.updatedAt < filter.updatedAfter],
  ['filter_updatedBefore', (memory, filter) => filter.updatedBefore !== undefined && memory.updatedAt > filter.updatedBefore],
  ['no_provenance', (memory, filter) => filter.requireProvenance !== false && memory.sources.length === 0 && memory.anchors.length === 0],
  ['duplicate_active', (memory, _filter, scan) => scan.live.has(knowledgeKey(memory))],
]

/** Why a tombstone is left alone, or undefined when it can come back. */
function skipReason(memory: Memory, filter: BackfillFilter, scan: Scan): string | undefined {
  return SKIP_RULES.find(([, skips]) => skips(memory, filter, scan))?.[0]
}

/** A new active memory that carries a tombstone's knowledge and supersedes it; the tombstone stays. */
function revived(op: Op, original: Memory): Memory {
  const memory: Memory = {
    ...original,
    id: ulid(),
    revision: 1,
    status: 'active',
    staleReason: undefined,
    tags: [...new Set([...original.tags, 'backfill:recovered'])],
    supersedes: [original.id],
    supersededBy: undefined,
    contradicts: undefined,
    reminderCount: 0,
    useCount: 0,
    createdAt: op.now,
    updatedAt: op.now,
    lastAccessedAt: undefined,
    lastVerifiedAt: undefined,
    lastUsedAt: undefined,
  }
  writeMemory(op.store.db, memory)
  syncEdges(op.store.db, memory, op.now)
  audit(op.store, op.now, 'memory.backfilled', { memoryId: original.id, detail: { newActiveId: memory.id } })
  return memory
}

/**
 * Finds the tombstones whose knowledge no live memory holds, and with `apply` brings each back as
 * a new memory. Without `apply` it only reports.
 */
export function backfill(op: Op, request: { filter?: BackfillFilter; apply?: boolean }): BackfillReport {
  const filter = request.filter ?? {}
  const scan = scanLive(op)
  const deleted = selectMemories(op.store.db, "SELECT id, data FROM memories WHERE status = 'deleted' ORDER BY updated_at")
  const report: BackfillReport = { apply: request.apply === true, examined: deleted.length, recoverable: 0, recovered: 0, skipped: 0, recoverableRecords: [], skippedRecords: [], byReason: {} }
  for (const memory of deleted) {
    const reason = skipReason(memory, filter, scan)
    if (reason !== undefined) {
      report.skipped++
      report.byReason[reason] = (report.byReason[reason] ?? 0) + 1
      report.skippedRecords.push(recordOf(memory, reason))
      continue
    }
    scan.live.add(knowledgeKey(memory))
    report.recoverable++
    const record = recordOf(memory, 'recoverable')
    if (report.apply) {
      record.newActiveId = revived(op, memory).id
      report.recovered++
    }
    report.recoverableRecords.push(record)
  }
  audit(op.store, op.now, report.apply ? 'memory.backfill_applied' : 'memory.backfill_dry_run', {
    detail: { examined: report.examined, recoverable: report.recoverable, recovered: report.recovered, skipped: report.skipped },
  })
  return report
}
