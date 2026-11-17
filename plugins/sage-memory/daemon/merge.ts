import { rmSync } from 'node:fs'
import { projectDirOf } from '../hooks/shared/layout.ts'
import type { ProjectRef } from '../hooks/shared/protocol.ts'
import { syncEdges } from './graph.ts'
import { log } from './log.ts'
import { canonical } from './nested.ts'
import { audit, readMemory, selectMemories, writeMemory } from './rows.ts'
import { openDatabase, type Store } from './stores.ts'

/**
 * One project folder written to two stores. The store key hashes the git common dir, so a folder
 * that became a git repository (`<root>` before, `<root>/.git` after) got a second store, and the
 * notes of the first were never reminded again. The store a session opens takes in every other store
 * of the same root: each memory it does not hold yet is copied with its id, dates and links, and the
 * emptied store's directory is removed. Byte-identical copies are left to hygiene, which merges them.
 */

/** The stores on disk whose project root is `ref`'s root, except `ref`'s own. */
export function sameRoot(ref: ProjectRef, refs: readonly ProjectRef[]): ProjectRef[] {
  const root = canonical(ref.root)
  return refs.filter(other => other.key !== ref.key && canonical(other.root) === root)
}

/** Copies every memory of the store file into `target` that `target` does not hold; answers how many. Runs inside the caller's transaction. */
export function takeIn(target: Store, file: string, now: string): number {
  const source = openDatabase(file)
  try {
    const memories = selectMemories(source, 'SELECT id, data FROM memories ORDER BY created_at, id')
    const missing = memories.filter(memory => readMemory(target.db, memory.id) === undefined)
    for (const memory of missing) {
      writeMemory(target.db, memory)
      syncEdges(target.db, memory, now)
    }
    return missing.length
  } finally {
    source.close()
  }
}

/** Takes every other store of `ref`'s root into `target` and removes their directories. */
export function mergeSameRoot(dir: string, ref: ProjectRef, refs: readonly ProjectRef[], target: Store, close: (key: string) => void): void {
  for (const other of sameRoot(ref, refs)) {
    const otherDir = projectDirOf(dir, other.key)
    close(other.key)
    const now = new Date().toISOString()
    target.db.exec('BEGIN IMMEDIATE')
    try {
      const copied = takeIn(target, `${otherDir}/sage.db`, now)
      audit(target, now, 'store.merged', { detail: { from: other.key, copied } })
      target.db.exec('COMMIT')
    } catch (err) {
      target.db.exec('ROLLBACK')
      throw err
    }
    rmSync(otherDir, { recursive: true, force: true })
    log(`${ref.key}: took in the store ${other.key} of the same root and removed it`)
  }
}
