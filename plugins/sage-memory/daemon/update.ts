import { CONTEXT_POLICIES, KINDS, PERSISTENCES, STATUSES, STRUCTURAL_KINDS, type Memory, type UpdatePatch, type UpdateResult } from '../hooks/shared/model.ts'
import { collapseSpace, normalizeTags } from '../hooks/shared/text.ts'
import { normalizeAnchors } from './anchors.ts'
import { conflict, refused } from './errors.ts'
import { syncEdges } from './graph.ts'
import { checkOwner, mustRead, storeLabel, type Op } from './op.ts'
import { checkRelations, supersede } from './remember.ts'
import { checkGrant, tombstone } from './remove.ts'
import { audit, readMemory, writeMemory } from './rows.ts'
import { checkAnchors, checkedText, checkIds, checkScore, checkTags, clamp01, EPHEMERAL_REFUSAL, isEphemeral, MAX_ITEMS, normalizeAudience, rejectSecrets } from './rules.ts'

/**
 * Changing one memory: only the fields the patch names change, the revision moves on, and the
 * session a memory was written in never changes. Ported from SAGE's `updateSage`; the context
 * policy can be patched too, and new `supersedes` entries become superseded. A new scope moves the
 * memory to the other store (`move.ts`); here a scope may only name the one the memory has.
 */

const PATCH_KEYS = new Set([
  'scope',
  'text',
  'tags',
  'persistence',
  'contextPolicy',
  'kind',
  'anchors',
  'audience',
  'importance',
  'confidence',
  'freshness',
  'status',
  'staleReason',
  'supersedes',
  'contradicts',
  'supersededBy',
  'force',
])

function oneOf(values: readonly string[], value: unknown, name: string): void {
  if (value !== undefined && !values.includes(value as string)) throw refused(`${name} must be one of: ${values.join(', ')}`)
}

function checkKeys(patch: UpdatePatch): void {
  if (patch === null || typeof patch !== 'object') throw refused('the patch must be an object')
  const keys = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
  const unknown = keys.find(key => !PATCH_KEYS.has(key))
  if (unknown) throw refused(`the patch takes no ${unknown}; a memory keeps the session it was written in`)
  if (keys.filter(key => key !== 'force').length === 0) throw refused('the patch changes nothing')
}

function checkLists(patch: UpdatePatch): void {
  for (const name of ['tags', 'anchors', 'supersedes', 'contradicts'] as const) {
    const list = patch[name]
    if (list !== undefined && (!Array.isArray(list) || list.length > MAX_ITEMS)) throw refused(`${name} must be an array of at most ${MAX_ITEMS} items`)
  }
  checkTags(patch.tags)
  checkAnchors(patch.anchors)
  checkIds(patch.supersedes, 'supersedes')
  checkIds(patch.contradicts, 'contradicts')
}

export function checkPatch(patch: UpdatePatch): void {
  checkKeys(patch)
  oneOf(['project', 'user'], patch.scope, 'scope')
  if (patch.text !== undefined) checkedText(patch.text)
  oneOf(PERSISTENCES, patch.persistence, 'persistence')
  oneOf(CONTEXT_POLICIES, patch.contextPolicy, 'contextPolicy')
  oneOf(KINDS, patch.kind, 'kind')
  oneOf(STATUSES, patch.status, 'status')
  oneOf(['manual', 'review'], patch.staleReason, 'staleReason')
  if (patch.staleReason !== undefined && patch.status !== 'stale') throw refused('staleReason goes with status stale')
  if (patch.supersededBy !== undefined && typeof patch.supersededBy !== 'string') throw refused('supersededBy must be a memory id')
  checkLists(patch)
  for (const name of ['importance', 'confidence', 'freshness'] as const) checkScore(patch[name], name)
  normalizeAudience(patch.audience)
}

/** The successor a `supersededBy` names exists here, is live, and does not point back. */
function checkSuccessor(op: Op, existing: Memory, patch: UpdatePatch): void {
  if (patch.supersededBy === undefined) return
  if ((patch.status ?? existing.status) !== 'superseded') throw refused('supersededBy goes with status superseded')
  if (patch.supersededBy === existing.id) throw refused('a memory cannot supersede itself')
  const successor = readMemory(op.store.db, patch.supersededBy)
  if (!successor || successor.status === 'deleted') throw refused(`supersededBy names ${patch.supersededBy}, which is not a live memory in the ${storeLabel(op.store)} store`)
  if (successor.supersededBy === existing.id) throw refused(`${patch.supersededBy} is itself superseded by ${existing.id}`)
}

/** The record can change this way: it is no tombstone, the text is no chatter, a structural kind keeps an anchor. */
function checkEditable(existing: Memory, patch: UpdatePatch): void {
  if (existing.status === 'deleted') throw conflict(`${existing.id} is deleted; recover it before changing it`)
  if (patch.text !== undefined && existing.scope !== 'session' && isEphemeral(collapseSpace(patch.text))) throw refused(EPHEMERAL_REFUSAL)
  const kind = patch.kind ?? existing.kind
  if (STRUCTURAL_KINDS.includes(kind) && (patch.anchors ?? existing.anchors).length === 0) throw refused(`a ${kind} needs at least one anchor`)
}

/** Every relationship the patch names points at another live memory of the store `op` writes. */
export function checkPatchRelations(op: Op, id: string, patch: UpdatePatch): void {
  const self = [...(patch.supersedes ?? []), ...(patch.contradicts ?? [])].some(other => other.trim() === id)
  if (self) throw refused('a memory cannot supersede or contradict itself')
  checkRelations(op, { supersedes: patch.supersedes, contradicts: patch.contradicts })
}

function checkLinks(op: Op, existing: Memory, patch: UpdatePatch): void {
  checkPatchRelations(op, existing.id, patch)
  checkSuccessor(op, existing, patch)
}

/** Text, kind, tags, anchors and audience, where the patch names them. */
function describingFields(op: Op, existing: Memory, patch: UpdatePatch): Partial<Memory> {
  const fields: Partial<Memory> = {}
  if (patch.text !== undefined) fields.text = collapseSpace(patch.text)
  if (patch.kind !== undefined) fields.kind = patch.kind
  if (patch.tags !== undefined) fields.tags = normalizeTags(patch.tags)
  if (patch.anchors !== undefined) fields.anchors = normalizeAnchors(op.root, existing.scope, patch.anchors)
  if (patch.audience !== undefined) fields.audience = normalizeAudience(patch.audience)
  return fields
}

/** Persistence, context policy and scores, where the patch names them. */
export function weighingFields(patch: UpdatePatch): Partial<Memory> {
  const fields: Partial<Memory> = {}
  if (patch.persistence !== undefined) fields.persistence = patch.persistence
  if (patch.contextPolicy !== undefined) fields.contextPolicy = patch.contextPolicy
  for (const name of ['importance', 'confidence', 'freshness'] as const) {
    const value = patch[name]
    if (value !== undefined) fields[name] = clamp01(value)
  }
  return fields
}

/**
 * A status set through a patch is a decision: `stale` is marked `manual` (or `review`) so no
 * automatic pass revives it, and leaving `superseded` drops the pointer to the successor.
 */
export function statusFields(patch: UpdatePatch): Partial<Memory> {
  if (patch.status === undefined) return {}
  const fields: Partial<Memory> = { status: patch.status, staleReason: patch.status === 'stale' ? (patch.staleReason ?? 'manual') : undefined }
  if (patch.status !== 'superseded') fields.supersededBy = undefined
  return fields
}

export function relationFields(patch: UpdatePatch): Partial<Memory> {
  const fields: Partial<Memory> = {}
  const listOf = (list: readonly string[]): string[] | undefined => {
    const distinct = [...new Set(list.map(id => id.trim()))]
    return distinct.length > 0 ? distinct : undefined
  }
  if (patch.supersedes !== undefined) fields.supersedes = listOf(patch.supersedes)
  if (patch.contradicts !== undefined) fields.contradicts = listOf(patch.contradicts)
  if (patch.supersededBy !== undefined) fields.supersededBy = patch.supersededBy
  return fields
}

/** Deletes through a patch, which then takes force and nothing else. */
function deleteByPatch(op: Op, existing: Memory, patch: UpdatePatch, sessionId: string | undefined): UpdateResult {
  const other = Object.entries(patch).find(([key, value]) => value !== undefined && key !== 'status' && key !== 'force')
  if (other) throw refused(`a patch that deletes takes force and nothing else, not ${other[0]}`)
  if (existing.status === 'deleted') return { memory: existing, superseded: [] }
  checkGrant(existing, { force: patch.force })
  const removedEdges = tombstone(op, existing)
  audit(op.store, op.now, 'memory.deleted', { memoryId: existing.id, sessionId, detail: { reason: 'status set to deleted', force: true, removedEdges } })
  return { memory: mustRead(op, existing.id), superseded: [] }
}

export type UpdateRequest = { id: string; patch: UpdatePatch; sessionId?: string }

/** Applies a patch to one memory. Runs inside the caller's transaction. */
export function updateMemory(op: Op, request: UpdateRequest): UpdateResult {
  const { patch } = request
  rejectSecrets(patch)
  checkPatch(patch)
  const existing = mustRead(op, request.id)
  checkOwner(existing, request.sessionId)
  if (patch.scope !== undefined && patch.scope !== existing.scope) throw refused(`${existing.id} is a ${existing.scope} memory; a scope change moves only a project memory to user or back`)
  if (patch.status === 'deleted') return deleteByPatch(op, existing, patch, request.sessionId)
  checkEditable(existing, patch)
  checkLinks(op, existing, patch)
  const memory: Memory = {
    ...existing,
    ...describingFields(op, existing, patch),
    ...weighingFields(patch),
    ...statusFields(patch),
    ...relationFields(patch),
    revision: existing.revision + 1,
    updatedAt: op.now,
  }
  writeMemory(op.store.db, memory)
  syncEdges(op.store.db, memory, op.now)
  const added = (memory.supersedes ?? []).filter(id => !(existing.supersedes ?? []).includes(id))
  return { memory, superseded: supersede(op, memory, added) }
}
