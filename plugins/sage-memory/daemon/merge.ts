import { homedir } from 'node:os'
import { rmSync } from 'node:fs'
import { projectDirOf } from '../hooks/shared/layout.ts'
import type { Memory } from '../hooks/shared/model.ts'
import type { ProjectRef } from '../hooks/shared/protocol.ts'
import { syncEdges } from './graph.ts'
import { log } from './log.ts'
import { canonical, isAboveProjects, rebase } from './nested.ts'
import { audit, readMemory, selectMemories, writeMemory } from './rows.ts'
import { openDatabase, type Store } from './stores.ts'

/**
 * One project folder written to several stores. The store key hashes the git common dir, so a
 * folder that became a git repository (`<root>` before, `<root>/.git` after) got a second store,
 * and a git repository inside a project folder (`app/client-ios`) got a store of its own. The
 * user's rule: one project folder keeps one store. A session inside a folder that a store above it
 * owns uses that store (`ownerOf`), and the owning store takes in every store of its root or below
 * it: each memory it does not hold yet is copied with its id, dates and links, its path anchors
 * rebased onto the owner's root, and the emptied store's directory is removed. Byte-identical
 * copies are left to hygiene, which merges them. The home directory and every folder above it own
 * nothing, because a store there would take in every project.
 */

/** Whether `inner` is `outer` or a folder below it, compared by whole path segments. */
function within(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(outer === '/' ? '/' : `${outer}/`)
}

/** The outermost store on disk whose root holds `ref`'s root, or undefined when none does but `ref`'s own. */
export function ownerOf(ref: ProjectRef, refs: readonly ProjectRef[], home: string = canonical(homedir())): ProjectRef | undefined {
  const root = canonical(ref.root)
  const owners = refs.filter(other => {
    if (other.key === ref.key) return false
    const outer = canonical(other.root)
    return outer !== root && !isAboveProjects(outer, home) && within(root, outer)
  })
  return owners.sort((a, b) => canonical(a.root).length - canonical(b.root).length)[0]
}

/** The stores on disk `ref`'s store takes in: those of its root or of a folder below it, except its own. */
export function takenIn(ref: ProjectRef, refs: readonly ProjectRef[], home: string = canonical(homedir())): ProjectRef[] {
  const root = canonical(ref.root)
  if (isAboveProjects(root, home)) return []
  return refs.filter(other => other.key !== ref.key && within(canonical(other.root), root))
}

/** A memory as the owner's store keeps it: its path anchors rebased from the store it came from. */
function rebased(memory: Memory, from: string, to: string): Memory {
  if (from === to) return memory
  return { ...memory, anchors: memory.anchors.map(anchor => (anchor.path === undefined ? anchor : { ...anchor, path: rebase(anchor.path, from, to) })) }
}

/** Copies every memory of the store file into `target` that `target` does not hold, rebased from `from` to `to`; answers how many. Runs inside the caller's transaction. */
export function takeIn(target: Store, file: string, from: string, to: string, now: string): number {
  const source = openDatabase(file)
  try {
    const memories = selectMemories(source, 'SELECT id, data FROM memories ORDER BY created_at, id')
    const missing = memories.filter(memory => readMemory(target.db, memory.id) === undefined).map(memory => rebased(memory, from, to))
    for (const memory of missing) {
      writeMemory(target.db, memory)
      syncEdges(target.db, memory, now)
    }
    return missing.length
  } finally {
    source.close()
  }
}

/** Takes every store `takenIn` names into `target` and removes their directories. */
export function mergeInto(dir: string, ref: ProjectRef, refs: readonly ProjectRef[], target: Store, close: (key: string) => void): void {
  for (const other of takenIn(ref, refs)) {
    const otherDir = projectDirOf(dir, other.key)
    close(other.key)
    const now = new Date().toISOString()
    target.db.exec('BEGIN IMMEDIATE')
    try {
      const copied = takeIn(target, `${otherDir}/sage.db`, other.root, ref.root, now)
      audit(target, now, 'store.merged', { detail: { from: other.key, root: other.root, copied } })
      target.db.exec('COMMIT')
    } catch (err) {
      target.db.exec('ROLLBACK')
      throw err
    }
    rmSync(otherDir, { recursive: true, force: true })
    log(`${ref.key}: took in the store ${other.key} (${other.root}) and removed it`)
  }
}
