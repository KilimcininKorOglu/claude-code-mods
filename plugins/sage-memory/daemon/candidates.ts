import { DECISIONS, SUGGESTED_ACTIONS, type Candidate, type Decision, type Memory, type ProposeInput, type Resolution } from '../hooks/shared/model.ts'
import { canonicalText, collapseSpace, normalizeTags } from '../hooks/shared/text.ts'
import { normalizeAnchors, normalizeSources } from './anchors.ts'
import { conflict, notFound, refused } from './errors.ts'
import { storeLabel, type Op } from './op.ts'
import { remember } from './remember.ts'
import { deleteMemory } from './remove.ts'
import { audit, readCandidate, readMemory, selectCandidates, writeCandidate } from './rows.ts'
import { checkAnchors, checkedText, checkRemember, checkTags, clamp01, normalizeAudience, rejectSecrets } from './rules.ts'
import { ulid } from './ulid.ts'
import { updateMemory } from './update.ts'

/**
 * Candidates: proposals a person decides. A proposal for a new memory is accepted into one; a
 * review of an existing memory (`memory_review`) is resolved with a decision. Every accept and
 * resolve runs in one transaction, so a candidate is never marked done without its change.
 */

const PENDING_SAME = `
  SELECT id, data FROM candidates
  WHERE status = 'pending' AND canonical_text = ? AND target_memory_id IS ?
  ORDER BY created_at DESC`

function checkTarget(op: Op, input: ProposeInput): void {
  if (input.targetMemoryId === undefined) return
  const target = readMemory(op.store.db, input.targetMemoryId)
  if (!target || target.status === 'deleted') throw refused(`${input.targetMemoryId} is not a live memory in the ${storeLabel(op.store)} store`)
}

/**
 * A review describes an existing memory, so it is held to the shape rules alone: its text may
 * quote a session note that `remember` would refuse outside the session scope.
 */
function checkReview(input: ProposeInput): string {
  const text = checkedText(input.text)
  checkTags(input.tags)
  checkAnchors(input.anchors)
  normalizeAudience(input.audience)
  if (input.suggestedAction !== undefined && !(SUGGESTED_ACTIONS as readonly string[]).includes(input.suggestedAction)) {
    throw refused(`suggestedAction must be one of: ${SUGGESTED_ACTIONS.join(', ')}`)
  }
  return text
}

/**
 * The text of a proposal, checked by the rules it will be written under. A proposal that names a
 * target is a review of that memory; a review without a target reviews nothing.
 */
function checkedProposal(input: ProposeInput): string {
  if (input.targetMemoryId !== undefined) return checkReview(input)
  if (input.kind === 'memory_review') throw refused('a review names the memory it reviews in targetMemoryId')
  return checkRemember(input)
}

function newCandidate(op: Op, input: ProposeInput, text: string): Candidate {
  const scope = input.scope ?? 'project'
  const candidate: Candidate = {
    id: `candidate_${ulid()}`,
    status: 'pending',
    text,
    kind: input.targetMemoryId === undefined ? (input.kind ?? 'fact') : 'memory_review',
    scope,
    confidence: clamp01(input.confidence ?? 0.6),
    importance: clamp01(input.importance ?? 0.6),
    tags: normalizeTags(input.tags),
    anchors: normalizeAnchors(op.root, scope, input.anchors ?? []),
    audience: normalizeAudience(input.audience),
    sources: normalizeSources(input.sources ?? [{ type: 'session' }]),
    createdAt: op.now,
    updatedAt: op.now,
    targetMemoryId: input.targetMemoryId,
    reviewReason: input.reviewReason,
    suggestedAction: input.suggestedAction,
    ownerSessionId: scope === 'session' ? input.ownerSessionId : undefined,
  }
  return JSON.parse(JSON.stringify(candidate)) as Candidate
}

/**
 * Opens a candidate under the rules `remember` writes by. A pending candidate of the same text,
 * scope and target is answered instead of a second one.
 */
export function propose(op: Op, input: ProposeInput): Candidate {
  rejectSecrets(input)
  const text = checkedProposal(input)
  checkTarget(op, input)
  const scope = input.scope ?? 'project'
  const same = selectCandidates(op.store.db, PENDING_SAME, canonicalText(text), input.targetMemoryId ?? null).find(candidate => candidate.scope === scope)
  if (same) return same
  const candidate = newCandidate(op, input, text)
  writeCandidate(op.store.db, candidate)
  audit(op.store, op.now, 'memory.candidate_created', { memoryId: candidate.targetMemoryId, detail: { candidateId: candidate.id } })
  return candidate
}

export function listCandidates(op: Op, includeResolved: boolean): Candidate[] {
  const query = includeResolved
    ? 'SELECT id, data FROM candidates ORDER BY updated_at DESC'
    : "SELECT id, data FROM candidates WHERE status = 'pending' ORDER BY updated_at DESC"
  return selectCandidates(op.store.db, query)
}

function mustReadCandidate(op: Op, id: string): Candidate {
  const candidate = readCandidate(op.store.db, id)
  if (!candidate) throw notFound(`no candidate ${id} in the ${storeLabel(op.store)} store`)
  return candidate
}

function closed(op: Op, candidate: Candidate, fields: Partial<Candidate>): Candidate {
  const next: Candidate = { ...candidate, ...fields, updatedAt: op.now }
  writeCandidate(op.store.db, next)
  return next
}

export type Accepted = { candidate: Candidate; memory?: Memory; resolution?: Resolution; alreadyResolved: boolean }

/** The decision a review's suggestion stands for, or a refusal that asks for one. */
function decisionOf(candidate: Candidate): Decision {
  const suggested = candidate.suggestedAction
  if (suggested !== undefined && (DECISIONS as readonly string[]).includes(suggested)) return suggested as Decision
  const about = candidate.targetMemoryId === undefined ? '' : ` of ${candidate.targetMemoryId}`
  throw conflict(`the review${about} suggests ${suggested ?? 'no action'}, so accepting it decides nothing; resolve it with delete, archive or keep`)
}

/**
 * Accepts a proposal into a memory. Accepting a review applies the decision it suggests (delete,
 * archive or keep); a review that suggests `investigate` or `update` needs an explicit decision.
 */
export function accept(op: Op, id: string): Accepted {
  const candidate = mustReadCandidate(op, id)
  if (candidate.status !== 'pending') return { candidate, alreadyResolved: true }
  if (candidate.kind === 'memory_review') {
    const resolution = resolve(op, { id, decision: decisionOf(candidate) })
    return { candidate: mustReadCandidate(op, id), resolution, alreadyResolved: false }
  }
  const { memory } = remember(op, {
    text: candidate.text,
    kind: candidate.kind,
    scope: candidate.scope,
    confidence: candidate.confidence,
    importance: candidate.importance,
    tags: candidate.tags,
    anchors: candidate.anchors,
    audience: candidate.audience,
    sources: candidate.sources,
    ownerSessionId: candidate.ownerSessionId,
  })
  const next = closed(op, candidate, { status: 'accepted', memoryId: memory.id })
  audit(op.store, op.now, 'memory.candidate_accepted', { memoryId: memory.id, detail: { candidateId: id } })
  return { candidate: next, memory, alreadyResolved: false }
}

/** Rejects a pending candidate; answers false when it was no longer pending. */
export function reject(op: Op, request: { id: string; reason: string }): boolean {
  const candidate = mustReadCandidate(op, request.id)
  if (candidate.status !== 'pending') return false
  closed(op, candidate, { status: 'rejected', reason: collapseSpace(request.reason) })
  audit(op.store, op.now, 'memory.candidate_rejected', { memoryId: candidate.targetMemoryId, detail: { candidateId: request.id, reason: request.reason } })
  return true
}

/**
 * Applies a decision to the candidate's target. A target that is gone, deleted already, or
 * permanent under `delete` is left as it is, and the candidate still closes.
 */
function applyDecision(op: Op, target: Memory | undefined, decision: Decision): boolean {
  if (decision === 'keep') return true
  if (!target || target.status === 'deleted') return false
  if (decision === 'archive') {
    updateMemory(op, { id: target.id, patch: { status: 'archived' } })
    return true
  }
  if (target.persistence === 'permanent') return false
  return deleteMemory(op, { id: target.id, reason: 'review resolved: delete', review: true })
}

function resolutionNote(candidate: Candidate, decision: Decision, reason: string | undefined): string {
  if (reason !== undefined && reason.trim() !== '') return collapseSpace(reason)
  if (candidate.reviewReason) return `review resolved (${candidate.reviewReason})`
  return `reviewed: ${decision}`
}

/** Resolves a review with a decision on its target: delete, archive or keep. */
export function resolve(op: Op, request: { id: string; decision: Decision; reason?: string }): Resolution {
  if (!(DECISIONS as readonly string[]).includes(request.decision)) throw refused(`decision must be one of: ${DECISIONS.join(', ')}`)
  const candidate = mustReadCandidate(op, request.id)
  if (candidate.kind !== 'memory_review') throw refused(`${candidate.id} proposes a new memory; accept or reject it, only a review is resolved`)
  const base = { candidateId: candidate.id, decision: request.decision, targetMemoryId: candidate.targetMemoryId }
  if (candidate.status !== 'pending') return { ...base, applied: false, alreadyResolved: true }
  const target = candidate.targetMemoryId === undefined ? undefined : readMemory(op.store.db, candidate.targetMemoryId)
  const applied = applyDecision(op, target, request.decision)
  const reason = resolutionNote(candidate, request.decision, request.reason)
  closed(op, candidate, { status: request.decision === 'keep' ? 'rejected' : 'accepted', reason })
  audit(op.store, op.now, 'memory.candidate_resolved', { memoryId: candidate.targetMemoryId, detail: { candidateId: candidate.id, decision: request.decision, applied } })
  return { ...base, applied }
}
