import type { Anchor, Candidate, FileMatch, FileMatchVia, FileMemories, Memory, PendingReview, Status } from '../hooks/shared/model.ts'
import type { Op } from './op.ts'
import { descending } from './order.ts'
import { readMemory, selectCandidates, selectMemories } from './rows.ts'

/**
 * The memories about one file, grouped by how they match it, as an editor shows them beside the
 * file: anchored to it or a directory above it, anchored to a symbol in it (a symbol under the
 * cursor first), or naming it in their text. Ported from SAGE's `findMemoriesForFile`; reading
 * never changes the store.
 */

export type ForFileOptions = {
  lineStart?: number
  lineEnd?: number
  /** Per group. */
  limit: number
  includeSuperseded: boolean
  includeDeleted: boolean
  sessionId?: string
  allSessions?: boolean
}

type Found = { via: FileMatchVia; strength: number }

const IN_REACH = `
  SELECT m.id AS id, m.data AS data FROM memories m
  WHERE m.status IN (SELECT value FROM json_each(?)) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?)`

function statusesOf(options: ForFileOptions): Status[] {
  const statuses: Status[] = ['active', 'stale', 'contradicted', 'archived']
  if (options.includeSuperseded) statuses.push('superseded')
  if (options.includeDeleted) statuses.push('deleted')
  return statuses
}

function overlaps(options: ForFileOptions, lineStart: number | undefined, lineEnd: number | undefined): boolean {
  const { lineStart: start, lineEnd: end } = options
  if (start === undefined || end === undefined || lineStart === undefined || lineEnd === undefined) return false
  return start <= lineEnd && end >= lineStart
}

/** A symbol-scoped note under the cursor matches best; a symbol anchor anywhere in the file still matches. */
function symbolMatch(memory: Memory, underCursor: boolean): Found {
  if (memory.scope === 'symbol') return { via: 'scope_symbol', strength: underCursor ? 1 : 0.92 }
  return { via: 'anchor_symbol', strength: underCursor ? 0.95 : 0.75 }
}

/** A directory or package anchor at the root or above the file. */
function holdsFile(anchor: Anchor, target: string): boolean {
  if (anchor.type !== 'directory' && anchor.type !== 'package') return false
  return anchor.path === '.' || target.startsWith(`${anchor.path}/`)
}

function anchorMatch(memory: Memory, target: string, options: ForFileOptions): Found | undefined {
  for (const anchor of memory.anchors) {
    if (anchor.path === target && anchor.type === 'symbol') return symbolMatch(memory, overlaps(options, anchor.lineStart, anchor.lineEnd))
    if (anchor.path === target) return memory.scope === 'file' ? { via: 'scope_file', strength: 1 } : { via: 'anchor_file', strength: 0.9 }
    if (anchor.path && holdsFile(anchor, target)) return { via: 'anchor_directory', strength: 0.5 }
  }
  return undefined
}

function matchOf(memory: Memory, target: string, basename: string, options: ForFileOptions): Found | undefined {
  const anchored = anchorMatch(memory, target, options)
  if (anchored) return anchored
  return basename !== '' && memory.text.toLowerCase().includes(basename.toLowerCase()) ? { via: 'mention', strength: 0.3 } : undefined
}

const PENDING_REVIEWS = "SELECT id, data FROM candidates WHERE status = 'pending' AND target_memory_id IS NOT NULL ORDER BY created_at"

function reviewOf(candidate: Candidate, now: number): PendingReview {
  const action = candidate.suggestedAction
  return {
    candidateId: candidate.id,
    reason: candidate.reviewReason ?? candidate.kind,
    suggestedAction: action === 'delete' || action === 'archive' || action === 'update' ? action : 'investigate',
    ageDays: Math.max(0, Math.floor((now - Date.parse(candidate.createdAt)) / 86_400_000)),
  }
}

function pendingReviews(op: Op): Map<string, PendingReview> {
  const now = Date.parse(op.now)
  const reviews = new Map<string, PendingReview>()
  for (const candidate of selectCandidates(op.store.db, PENDING_REVIEWS)) {
    if (candidate.targetMemoryId !== undefined) reviews.set(candidate.targetMemoryId, reviewOf(candidate, now))
  }
  return reviews
}

/** The active memory a superseded one points to, when there is one. */
function activeSuccessor(op: Op, memory: Memory): string | undefined {
  if (memory.status !== 'superseded' || memory.supersededBy === undefined) return undefined
  return readMemory(op.store.db, memory.supersededBy)?.status === 'active' ? memory.supersededBy : undefined
}

/** The matches of one store; `target` is the file's path relative to the project root. */
export function fileMatches(op: Op, target: string, options: ForFileOptions): FileMatch[] {
  const basename = target === '.' ? '' : (target.split('/').at(-1) ?? '')
  const reviews = pendingReviews(op)
  const memories = selectMemories(op.store.db, IN_REACH, JSON.stringify(statusesOf(options)), options.allSessions === true ? 1 : 0, options.sessionId ?? null)
  const matches: FileMatch[] = []
  for (const memory of memories) {
    const found = matchOf(memory, target, basename, options)
    if (!found) continue
    const successor = activeSuccessor(op, memory)
    const review = reviews.get(memory.id)
    matches.push({ memory, matchedVia: found.via, matchStrength: found.strength, ...(successor ? { supersededByActiveId: successor } : {}), ...(review ? { pendingReview: review } : {}) })
  }
  return matches
}

function byStrength(left: FileMatch, right: FileMatch): number {
  return right.matchStrength - left.matchStrength || descending(left.memory.updatedAt, right.memory.updatedAt)
}

/** The matches of every store grouped, strongest and newest first, each group cut to the limit. */
export function groupFileMatches(target: string, matches: readonly FileMatch[], limit: number): FileMemories {
  const group = (vias: readonly FileMatchVia[]): FileMatch[] =>
    matches
      .filter(match => vias.includes(match.matchedVia))
      .sort(byStrength)
      .slice(0, limit)
  const primaryMatches = group(['scope_file', 'anchor_file', 'anchor_directory'])
  const symbolMatches = group(['scope_symbol', 'anchor_symbol'])
  const relatedMatches = group(['mention'])
  const returned = [...primaryMatches, ...symbolMatches, ...relatedMatches]
  return {
    filePath: target,
    primaryMatches,
    symbolMatches,
    relatedMatches,
    totalCount: returned.length,
    activeCount: returned.filter(match => match.memory.status === 'active').length,
    supersededCount: returned.filter(match => match.memory.status === 'superseded').length,
    reviewPendingCount: returned.filter(match => match.pendingReview !== undefined).length,
  }
}
