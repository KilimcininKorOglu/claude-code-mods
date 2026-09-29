import { PATH_ANCHOR_TYPES, STRUCTURAL_KINDS, type Anchor, type Memory, type UpdatePatch } from '../hooks/shared/model.ts'
import { collapseSpace, normalizeTags } from '../hooks/shared/text.ts'
import { normalizeAnchors } from './anchors.ts'
import { conflict, refused } from './errors.ts'
import { clearReferences, dropEdges, syncEdges } from './graph.ts'
import { checkOwner, mustRead, storeLabel, type Op } from './op.ts'
import { audit, readMemory, sql, writeMemory } from './rows.ts'
import { EPHEMERAL_REFUSAL, isEphemeral, normalizeAudience, rejectSecrets } from './rules.ts'
import { checkPatch, checkPatchRelations, relationFields, statusFields, weighingFields, type UpdateRequest } from './update.ts'

/**
 * Moving a memory between the project store and the user store: `update` with the other scope. The
 * memory keeps its id, scores and history and takes the patch's other fields on the way. The two
 * stores are two databases with no shared transaction, so the move is steps the route runs in
 * turn: build the record from the source, write it into the target, remove it from the source,
 * and take the copy out of the target again when the removal fails.
 */

/** A moved memory's anchors: the patch's, else its own; the user store keeps no path anchor. */
function movedAnchors(to: Op, existing: Memory, scope: 'project' | 'user', patch: UpdatePatch): Anchor[] {
  if (patch.anchors !== undefined) return normalizeAnchors(to.root, scope, patch.anchors)
  return scope === 'user' ? existing.anchors.filter(anchor => !PATH_ANCHOR_TYPES.includes(anchor.type)) : existing.anchors
}

/** A move takes a live project or user memory and neither deletes nor supersedes it on the way. */
function checkMovable(existing: Memory, patch: UpdatePatch): void {
  if (existing.scope !== 'project' && existing.scope !== 'user') throw refused(`${existing.id} is a ${existing.scope} memory; a scope change moves only a project memory to user or back`)
  if (existing.status !== 'active' && existing.status !== 'stale') throw conflict(`${existing.id} is ${existing.status}; only a live memory moves to another scope`)
  if (patch.status === 'deleted' || patch.status === 'superseded' || patch.supersededBy !== undefined) throw refused('a scope change cannot also delete or supersede the memory')
  if (patch.text !== undefined && isEphemeral(collapseSpace(patch.text))) throw refused(EPHEMERAL_REFUSAL)
}

/** The relationships the patch names, checked against the target, which holds none of `existing`'s own. */
function movedRelations(to: Op, existing: Memory, patch: UpdatePatch): Partial<Memory> {
  checkPatchRelations(to, existing.id, patch)
  return { supersedes: undefined, contradicts: undefined, supersededBy: undefined, ...relationFields(patch) }
}

/**
 * The record a move writes into the target, built from the source's copy with the patch applied.
 * Its links to other memories are dropped, since they name ids of the source store; the patch may
 * name new ones in the target. Runs inside the source's transaction and writes nothing.
 */
export function movedMemory(from: Op, to: Op, request: UpdateRequest): Memory {
  const { patch } = request
  if (patch.scope === undefined) throw refused('a move needs a scope')
  rejectSecrets(patch)
  checkPatch(patch)
  const existing = mustRead(from, request.id)
  checkOwner(existing, request.sessionId)
  checkMovable(existing, patch)
  const anchors = movedAnchors(to, existing, patch.scope, patch)
  const kind = patch.kind ?? existing.kind
  if (STRUCTURAL_KINDS.includes(kind) && anchors.length === 0) throw refused(`a ${kind} needs at least one anchor, and the ${patch.scope} store keeps none of this one's; pass another kind with the scope`)
  return {
    ...existing,
    ...weighingFields(patch),
    ...statusFields(patch),
    ...movedRelations(to, existing, patch),
    scope: patch.scope,
    kind,
    anchors,
    text: patch.text === undefined ? existing.text : collapseSpace(patch.text),
    tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
    audience: patch.audience === undefined ? existing.audience : normalizeAudience(patch.audience),
    ownerSessionId: undefined,
    revision: existing.revision + 1,
    updatedAt: from.now,
  }
}

/** Writes the moved memory into the target; an id the target holds already is refused. */
export function insertMoved(to: Op, memory: Memory, from: string, sessionId: string | undefined): void {
  if (readMemory(to.store.db, memory.id) !== undefined) throw conflict(`the ${storeLabel(to.store)} store holds ${memory.id} already`)
  writeMemory(to.store.db, memory)
  syncEdges(to.store.db, memory, to.now)
  audit(to.store, to.now, 'memory.moved_in', { memoryId: memory.id, sessionId, detail: { from } })
}

/** Removes a memory's row, vectors, edges and the links other memories hold to it, for good. */
export function dropMemory(op: Op, id: string): void {
  clearReferences(op.store.db, id, op.now)
  dropEdges(op.store.db, id)
  sql(op.store.db, 'DELETE FROM vectors WHERE memory_id = ?').run(id)
  sql(op.store.db, 'DELETE FROM memories WHERE id = ?').run(id)
}

/**
 * Takes the moved memory out of the source; no tombstone stays, since the id now lives in the
 * target and a lookup reads the project store first. A copy changed since the move read it is
 * refused, so the change is not lost.
 */
export function removeMoved(from: Op, moved: Memory, to: string, sessionId: string | undefined): void {
  const current = mustRead(from, moved.id)
  if (current.revision !== moved.revision - 1) throw conflict(`${moved.id} changed while it moved; try the scope change again`)
  dropMemory(from, moved.id)
  audit(from.store, from.now, 'memory.moved_out', { memoryId: moved.id, sessionId, detail: { to } })
}
