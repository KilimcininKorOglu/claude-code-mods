import type { Memory, SuggestedAction } from '../hooks/shared/model.ts'
import { textKey } from '../hooks/shared/text.ts'
import { propose } from './candidates.ts'
import { bucketKey, bucketsOf } from './dedupe.ts'
import { dropEdges, syncEdges } from './graph.ts'
import type { Op } from './op.ts'
import { ascending } from './order.ts'
import { tombstone } from './remove.ts'
import { audit, readMemory, selectCandidates, selectIds, selectMemories, sql, writeMemory } from './rows.ts'
import { isPossiblyContradictory } from './rules.ts'

/**
 * Hygiene's reviews and deletions, ported from SAGE: a pair that cannot both hold is flagged, a
 * memory that looks stale or doubtful gets a review a person decides, an expired session
 * memory is deleted, and old tombstones can be removed for good. A memory with a pending review
 * gets no second one, and one a person reviewed in the last 90 days is not asked about again while
 * it says the same thing.
 */

const DAY_MS = 86_400_000

/** How many memories of one bucket the pairwise contradiction pass compares, the newest changes first. */
const CONTRADICTION_BUCKET_CAP = 80

/** How long a person's review keeps the same memory from being asked about again. */
const REVIEW_SUPPRESSION_MS = 90 * DAY_MS

const NEWEST_FIRST = "SELECT id, data FROM memories WHERE status = 'active' ORDER BY updated_at DESC, id DESC"

const PENDING_TARGETS = "SELECT DISTINCT target_memory_id AS id FROM candidates WHERE status = 'pending' AND target_memory_id IS NOT NULL"

type Review = { reason: string; action: SuggestedAction }

/** The memories a pending candidate reviews. */
export function pendingTargets(op: Op): Set<string> {
  return new Set(selectIds(op.store.db, PENDING_TARGETS))
}

/** Opens a review of the memory unless one is pending; answers whether it opened one. */
function openReview(op: Op, memory: Memory, review: Review, pending: Set<string>): boolean {
  if (pending.has(memory.id)) return false
  propose(op, {
    text: memory.text,
    targetMemoryId: memory.id,
    reviewReason: review.reason,
    suggestedAction: review.action,
    scope: memory.scope,
    ownerSessionId: memory.ownerSessionId,
    confidence: 0.6,
    importance: 0.4,
    tags: [...memory.tags, `persistence:${memory.persistence}`],
    anchors: memory.anchors,
    sources: [{ type: 'session' }],
  })
  pending.add(memory.id)
  return true
}

function linked(left: Memory, right: Memory): boolean {
  return (left.contradicts ?? []).includes(right.id) || (right.contradicts ?? []).includes(left.id)
}

/** The pair as [newer, older], by creation, the id breaking a tie. */
function newerFirst(left: Memory, right: Memory): [Memory, Memory] {
  return (ascending(left.createdAt, right.createdAt) || ascending(left.id, right.id)) < 0 ? [right, left] : [left, right]
}

type Flag = { memory: Memory; other: Memory }

/** The newer memory of each pair not yet linked that cannot both hold, with the older one; a memory is flagged once. */
function contradictingPairs(memories: readonly Memory[]): Map<string, Flag> {
  const flagged = new Map<string, Flag>()
  for (const bucket of bucketsOf(memories, memory => bucketKey(memory))) {
    const compared = bucket.slice(0, CONTRADICTION_BUCKET_CAP)
    compared.forEach((left, i) => {
      compared.forEach((right, j) => {
        if (j <= i || linked(left, right) || !isPossiblyContradictory(left.text, right.text)) return
        const [memory, other] = newerFirst(left, right)
        if (!flagged.has(memory.id)) flagged.set(memory.id, { memory, other })
      })
    })
  }
  return flagged
}

/**
 * Links the newer memory of each pair that cannot both hold to the older one (`contradicts`) and
 * opens a review of it. The status stays: a person decides which one holds.
 */
export function flagContradictions(op: Op): { contradictions: number; reviews: number } {
  const pending = pendingTargets(op)
  const flagged = contradictingPairs(selectMemories(op.store.db, NEWEST_FIRST))
  let reviews = 0
  for (const { memory, other } of flagged.values()) {
    const next: Memory = { ...memory, contradicts: [...new Set([...(memory.contradicts ?? []), other.id])], revision: memory.revision + 1, updatedAt: op.now }
    writeMemory(op.store.db, next)
    syncEdges(op.store.db, next, op.now)
    if (openReview(op, next, { reason: `Possible contradiction with memory ${other.id}`, action: 'investigate' }, pending)) reviews++
  }
  if (flagged.size > 0) audit(op.store, op.now, 'memory.hygiene_contradictions', { detail: { flagged: flagged.size } })
  return { contradictions: flagged.size, reviews }
}

export type ReviewLimits = { staleMs: number; lowConfidenceMs: number; sessionRetentionMs: number }

const REVIEWABLE = "SELECT id FROM memories WHERE status NOT IN ('deleted', 'superseded', 'contradicted') AND persistence != 'permanent' ORDER BY id"

const RESOLVED_REVIEWS = "SELECT id, data FROM candidates WHERE status != 'pending' AND target_memory_id IS NOT NULL AND updated_at >= ?"

/** The texts a person reviewed in the last 90 days, by the memory reviewed. */
function reviewedTexts(op: Op, nowMs: number): Map<string, string[]> {
  const reviewed = new Map<string, string[]>()
  for (const candidate of selectCandidates(op.store.db, RESOLVED_REVIEWS, new Date(nowMs - REVIEW_SUPPRESSION_MS).toISOString())) {
    if (candidate.kind !== 'memory_review' || candidate.targetMemoryId === undefined) continue
    reviewed.set(candidate.targetMemoryId, [...(reviewed.get(candidate.targetMemoryId) ?? []), textKey(candidate.text)])
  }
  return reviewed
}

function sessionExpired(memory: Memory, nowMs: number, limits: ReviewLimits): boolean {
  if (memory.scope !== 'session') return false
  if (memory.expiresAt !== undefined) return Date.parse(memory.expiresAt) <= nowMs
  return nowMs - Date.parse(memory.updatedAt) >= limits.sessionRetentionMs
}

/** A doubtful memory left alone long enough, or a stale one left alone longer. */
function agedReview(memory: Memory, age: number, limits: ReviewLimits): Review | undefined {
  if (memory.confidence < 0.5 && age >= limits.lowConfidenceMs) return { reason: 'confidence_low', action: 'investigate' }
  if (memory.status === 'stale' && age >= limits.staleMs) return { reason: memory.confidence < 0.5 ? 'confidence_low' : 'freshness_low', action: 'investigate' }
  return undefined
}

/** Why a memory needs a review, and what to do about it, if it does. Its age counts from its last reminder, use or change. */
function reviewOf(memory: Memory, nowMs: number, limits: ReviewLimits): Review | undefined {
  const age = nowMs - Date.parse(memory.lastAccessedAt ?? memory.updatedAt)
  if (memory.expiresAt !== undefined && Date.parse(memory.expiresAt) <= nowMs) return { reason: 'expires_at_passed', action: 'delete' }
  return agedReview(memory, age, limits)
}

type Pass = { nowMs: number; limits: ReviewLimits; pending: Set<string>; reviewed: Map<string, string[]>; reviews: number; sessionDeleted: number }

function reviewedUnchanged(pass: Pass, memory: Memory): boolean {
  const key = textKey(memory.text)
  return (pass.reviewed.get(memory.id) ?? []).some(text => key.startsWith(text))
}

function reviewOne(op: Op, memory: Memory, pass: Pass): void {
  if (sessionExpired(memory, pass.nowMs, pass.limits)) {
    tombstone(op, memory, true)
    audit(op.store, op.now, 'memory.session_gc', { memoryId: memory.id, detail: { reason: memory.expiresAt === undefined ? 'session_retention' : 'expires_at_passed' } })
    pass.sessionDeleted++
    return
  }
  const review = reviewOf(memory, pass.nowMs, pass.limits)
  if (review !== undefined && !reviewedUnchanged(pass, memory) && openReview(op, memory, review, pass.pending)) pass.reviews++
}

/**
 * Deletes the expired session memories and opens the reviews the rules ask for, over every memory
 * that is neither permanent nor gone. Each memory is read as it is when its turn comes, since a
 * deletion takes its id out of the memories that named it.
 */
export function reviewAndCollect(op: Op, limits: ReviewLimits): { reviews: number; sessionDeleted: number } {
  const nowMs = Date.parse(op.now)
  const pass: Pass = { nowMs, limits, pending: pendingTargets(op), reviewed: reviewedTexts(op, nowMs), reviews: 0, sessionDeleted: 0 }
  for (const id of selectIds(op.store.db, REVIEWABLE)) {
    const memory = readMemory(op.store.db, id)
    if (memory !== undefined) reviewOne(op, memory, pass)
  }
  return { reviews: pass.reviews, sessionDeleted: pass.sessionDeleted }
}

const PURGEABLE = "SELECT id FROM memories WHERE status = 'deleted' AND persistence != 'permanent' AND updated_at <= ?"

/** Removes for good the tombstones deleted at or before the cutoff, with their edges and vectors; a permanent one stays. */
export function purgeDeleted(op: Op, cutoff: string): number {
  const ids = selectIds(op.store.db, PURGEABLE, cutoff)
  for (const id of ids) {
    dropEdges(op.store.db, id)
    sql(op.store.db, 'DELETE FROM vectors WHERE memory_id = ?').run(id)
    sql(op.store.db, 'DELETE FROM memories WHERE id = ?').run(id)
  }
  if (ids.length > 0) audit(op.store, op.now, 'memory.purge_deleted', { detail: { purged: ids.length, cutoff } })
  return ids.length
}
