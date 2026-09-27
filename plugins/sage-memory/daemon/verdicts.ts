import type { Anchor, Memory, MemoryVerification } from '../hooks/shared/model.ts'
import { keyOf } from './anchors.ts'
import type { Op } from './op.ts'
import { audit, readMemory, writeMemory } from './rows.ts'
import { transaction } from './stores.ts'
import type { Checked } from './verify.ts'

/**
 * Writing what a verification found. A memory is written as it is when the write runs; one whose
 * status or anchors changed since the check is left to the next check. A status change moves the
 * revision on. A verification stamp (`lastVerifiedAt`, and `freshness` 1 for a verified active
 * memory) does not, since the memory still says the same thing. Only a memory verification made
 * stale comes back to active: one a person or a review made stale stays stale.
 */

export type Applied = { staled: string[]; reactivated: string[]; verified: number }

/** How many checks one transaction writes, so other requests run between the slices. */
const SLICE = 200

export function isVerificationStale(memory: Memory): boolean {
  return memory.status === 'stale' && memory.staleReason === 'verification'
}

function anchorsKey(anchors: readonly Anchor[]): string {
  return JSON.stringify(anchors.map(keyOf))
}

type Outcome = 'staled' | 'reactivated' | 'verified' | 'stamped'

type Change = { outcome: Outcome; memory: Memory }

function changeOf(op: Op, current: Memory, result: MemoryVerification): Change | undefined {
  const at = result.checkedAt
  const moved = { revision: current.revision + 1, updatedAt: op.now, lastVerifiedAt: at }
  if (result.status === 'stale' && current.status === 'active') return { outcome: 'staled', memory: { ...current, ...moved, status: 'stale', staleReason: 'verification' } }
  if (result.status === 'verified' && isVerificationStale(current)) {
    return { outcome: 'reactivated', memory: { ...current, ...moved, status: 'active', staleReason: undefined, freshness: 1 } }
  }
  if (result.status === 'verified' && current.status === 'active') return { outcome: 'verified', memory: { ...current, freshness: 1, lastVerifiedAt: at } }
  return current.anchors.length > 0 ? { outcome: 'stamped', memory: { ...current, lastVerifiedAt: at } } : undefined
}

/** The reason of the first anchor the check found stale, for the audit log. */
function staleCause(result: MemoryVerification): string {
  return result.anchors.find(anchor => anchor.status === 'stale')?.reason ?? 'an anchor is stale'
}

function record(op: Op, change: Change, result: MemoryVerification, applied: Applied): void {
  const id = change.memory.id
  if (change.outcome === 'staled') {
    applied.staled.push(id)
    audit(op.store, op.now, 'memory.staled', { memoryId: id, detail: { reason: staleCause(result) } })
  } else if (change.outcome === 'reactivated') {
    applied.reactivated.push(id)
    audit(op.store, op.now, 'memory.reactivated', { memoryId: id, detail: { reason: 'every anchor verified again' } })
  } else if (change.outcome === 'verified') {
    applied.verified++
  }
}

function applyOne(op: Op, check: Checked, applied: Applied): void {
  const current = readMemory(op.store.db, check.result.memoryId)
  if (!current || current.status !== check.status || anchorsKey(current.anchors) !== anchorsKey(check.anchors)) return
  const change = changeOf(op, current, check.result)
  if (!change) return
  writeMemory(op.store.db, change.memory)
  record(op, change, check.result, applied)
}

/** Writes the checks of one store, a slice at a time, each slice in a transaction of its own. */
export async function writeVerifications(op: Op, checks: readonly Checked[]): Promise<Applied> {
  const applied: Applied = { staled: [], reactivated: [], verified: 0 }
  for (let start = 0; start < checks.length; start += SLICE) {
    const slice = checks.slice(start, start + SLICE)
    await transaction(op.store, () => slice.forEach(check => applyOne(op, check, applied)))
  }
  return applied
}
