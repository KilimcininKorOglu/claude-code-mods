import type { Memory } from '../hooks/shared/model.ts'
import { canonicalText } from '../hooks/shared/text.ts'
import { distinct } from './anchors.ts'
import { syncEdges } from './graph.ts'
import type { Op } from './op.ts'
import { ascending } from './order.ts'
import { supersede } from './remember.ts'
import { audienceKey, selectMemories, writeMemory } from './rows.ts'

/**
 * Hygiene's merges: active memories of one scope (one session's, for session memories) and one
 * audience with the same text become one. The survivor takes the lists of all of them and
 * supersedes the rest. Memories close only by words or in meaning are never merged here, because
 * neither tells "tabs over spaces" from "spaces over tabs" (word overlap 1.0, cosine 0.961): the
 * triage's merge question judges such pairs.
 */

const ACTIVE = "SELECT id, data FROM memories WHERE status = 'active' ORDER BY id"

/** The key of a bucket: the scope (one session's, for session memories), the parts given, and the audience. */
export function bucketKey(memory: Memory, ...parts: string[]): string {
  const scope = memory.scope === 'session' ? `session:${memory.ownerSessionId ?? ''}` : memory.scope
  return [scope, ...parts, audienceKey(memory) ?? ''].join('\0')
}

/** The memories grouped by key, each group in the order the memories come. */
export function bucketsOf(memories: readonly Memory[], keyOf: (memory: Memory) => string): Memory[][] {
  const buckets = new Map<string, Memory[]>()
  for (const memory of memories) {
    const key = keyOf(memory)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(memory)
    else buckets.set(key, [memory])
  }
  return [...buckets.values()]
}

/** The more important first, then the more confident, then the older. */
function byWeight(left: Memory, right: Memory): number {
  return right.importance - left.importance || right.confidence - left.confidence || ascending(left.createdAt, right.createdAt) || ascending(left.id, right.id)
}

/** The survivor first: a permanent memory, then by weight. */
function keeperFirst(left: Memory, right: Memory): number {
  return Number(right.persistence === 'permanent') - Number(left.persistence === 'permanent') || byWeight(left, right)
}

/** Writes the survivor with the lists of every member folded in, then supersedes the members; answers it and the ids it moved. */
function absorb(op: Op, keeper: Memory, members: readonly Memory[], text: string): { memory: Memory; moved: string[] } {
  const all = [keeper, ...members]
  const memory: Memory = {
    ...keeper,
    text,
    tags: [...new Set(all.flatMap(member => member.tags))],
    anchors: distinct(all.flatMap(member => member.anchors)),
    sources: distinct(all.flatMap(member => member.sources)),
    supersedes: [...new Set([...(keeper.supersedes ?? []), ...members.map(member => member.id)])],
    revision: keeper.revision + 1,
    updatedAt: op.now,
  }
  writeMemory(op.store.db, memory)
  syncEdges(op.store.db, memory, op.now)
  return { memory, moved: supersede(op, memory, members.map(member => member.id)) }
}

/** Merges the active memories of one scope and audience that have the same text, of any kind; answers how many were superseded. */
export function mergeExact(op: Op): number {
  let merged = 0
  for (const bucket of bucketsOf(selectMemories(op.store.db, ACTIVE), memory => bucketKey(memory, canonicalText(memory.text)))) {
    const [keeper, ...members] = [...bucket].sort(keeperFirst)
    if (keeper !== undefined && members.length > 0) merged += absorb(op, keeper, members, keeper.text).moved.length
  }
  return merged
}

