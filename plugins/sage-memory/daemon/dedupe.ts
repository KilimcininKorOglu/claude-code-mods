import type { Memory } from '../hooks/shared/model.ts'
import { canonicalText } from '../hooks/shared/text.ts'
import { distinct } from './anchors.ts'
import { syncEdges } from './graph.ts'
import type { Op } from './op.ts'
import { ascending } from './order.ts'
import { supersede } from './remember.ts'
import { audienceKey, selectMemories, writeMemory } from './rows.ts'
import { isNearDuplicate, isPossiblyContradictory } from './rules.ts'

/**
 * Hygiene's merges: active memories of one scope (one session's, for session memories) and one
 * audience that say the same thing become one. The survivor takes the lists of all of them and
 * supersedes the rest. Ported from SAGE's hygiene; a near-duplicate joins the survivor only when
 * the two can both hold, since a third memory may link two that contradict each other.
 */

const ACTIVE = "SELECT id, data FROM memories WHERE status = 'active' ORDER BY id"

/** How many memories of one bucket the pairwise near-duplicate pass compares, the weightiest first. */
const NEAR_BUCKET_CAP = 80

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

/** The same memory in other words, and the two can both hold. */
function sameInOtherWords(left: Memory, right: Memory): boolean {
  return isNearDuplicate(left, right) && !isPossiblyContradictory(left.text, right.text)
}

/** The groups of two or more memories that pairs of near-duplicates join (union-find). */
function linkedGroups(memories: readonly Memory[]): Memory[][] {
  const parent = memories.map((_, index) => index)
  const find = (index: number): number => {
    let at = index
    for (let up = parent[at]; up !== undefined && up !== at; up = parent[at]) at = up
    return at
  }
  memories.forEach((left, i) => {
    memories.forEach((right, j) => {
      if (j > i && sameInOtherWords(left, right)) parent[find(j)] = find(i)
    })
  })
  const groups = new Map<number, Memory[]>()
  memories.forEach((memory, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), memory]))
  return [...groups.values()].filter(group => group.length > 1)
}

export type NearMerge = { merged: number; rewritten: Memory[] }

/** Merges into a group's survivor the members that are near-duplicates of it itself, not only of another member. */
function mergeGroup(op: Op, group: readonly Memory[], into: NearMerge): void {
  const [keeper, ...rest] = [...group].sort(keeperFirst)
  if (keeper === undefined) return
  const members = rest.filter(member => sameInOtherWords(keeper, member))
  if (members.length === 0) return
  const text = members.reduce((longest, member) => (member.text.length > longest.length ? member.text : longest), keeper.text)
  const { memory, moved } = absorb(op, keeper, members, text)
  into.merged += moved.length
  if (text !== keeper.text) into.rewritten.push(memory)
}

/**
 * Merges active memories of one scope, kind and audience that say the same thing in other words,
 * among the 80 weightiest of each bucket. The survivor takes the longest text of its group; the
 * ones whose text changed are answered, to be embedded again.
 */
export function mergeNear(op: Op): NearMerge {
  const merged: NearMerge = { merged: 0, rewritten: [] }
  for (const bucket of bucketsOf(selectMemories(op.store.db, ACTIVE), memory => bucketKey(memory, memory.kind))) {
    const compared = [...bucket].sort(byWeight).slice(0, NEAR_BUCKET_CAP)
    for (const group of linkedGroups(compared)) mergeGroup(op, group, merged)
  }
  return merged
}
