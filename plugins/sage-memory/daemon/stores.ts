import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { isProjectKey, layoutOf, projectDirOf } from '../hooks/shared/layout.ts'
import type { ProjectRef } from '../hooks/shared/protocol.ts'
import { writeAtomic } from './files.ts'
import { applyPragmas, migrate } from './schema.ts'

/**
 * One open database: its file, the connection, when a request last used it, its write queue, and
 * how many queued writes have not finished (a store with one is never closed as idle).
 */
export type Store = { name: string; file: string; db: DatabaseSync; lastUsed: number; queue: Promise<void>; pending: number }

export type Stores = {
  /** The cross-project store (`user` scope). */
  global: () => Store
  /** One project's store, opened on first use; the project's `project.json` is written then. */
  project: (ref: ProjectRef) => Store
  /** Closes every store unused for `maxIdleMs`; answers how many closed. */
  closeIdle: (now: number, maxIdleMs: number) => number
  closeAll: () => void
  /** The names of the open stores: `global`, or a project key. */
  names: () => string[]
}

/** Opens a database file, sets the pragmas and brings its schema up to date. */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    applyPragmas(db)
    migrate(db)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

/**
 * Runs `work` after every write queued on the store before it, so writes that await (an
 * embedding between two statements) never interleave. The queue keeps going after a failure.
 */
export function serial<T>(store: Store, work: () => Promise<T> | T): Promise<T> {
  store.pending++
  const run = store.queue.then(() => work())
  const settle = (): void => {
    store.pending--
  }
  store.queue = run.then(settle, settle)
  return run
}

function recordProject(dir: string, ref: ProjectRef): void {
  const text = JSON.stringify({ key: ref.key, name: ref.name, root: ref.root, commonDir: ref.commonDir, updatedAt: new Date().toISOString() }, null, 2)
  writeAtomic(`${projectDirOf(dir, ref.key)}/project.json`, `${text}\n`)
}

export function createStores(dir: string): Stores {
  const open = new Map<string, Store>()
  const roots = new Map<string, string>()

  const use = (name: string, file: string): Store => {
    const known = open.get(name)
    const store = known ?? { name, file, db: openDatabase(file), lastUsed: 0, queue: Promise.resolve(), pending: 0 }
    store.lastUsed = Date.now()
    open.set(name, store)
    return store
  }

  const project = (ref: ProjectRef): Store => {
    if (!isProjectKey(ref.key)) throw new Error(`not a project key: ${JSON.stringify(ref.key)}`)
    const projectDir = projectDirOf(dir, ref.key)
    mkdirSync(projectDir, { recursive: true, mode: 0o700 })
    if (roots.get(ref.key) !== ref.root) {
      recordProject(dir, ref)
      roots.set(ref.key, ref.root)
    }
    return use(ref.key, `${projectDir}/sage.db`)
  }

  const close = (name: string): void => {
    open.get(name)?.db.close()
    open.delete(name)
  }

  const closeIdle = (now: number, maxIdleMs: number): number => {
    const idle = [...open.values()].filter(store => store.pending === 0 && now - store.lastUsed >= maxIdleMs)
    idle.forEach(store => close(store.name))
    return idle.length
  }

  return {
    global: () => use('global', layoutOf(dir).globalDb),
    project,
    closeIdle,
    closeAll: () => [...open.keys()].forEach(close),
    names: () => [...open.keys()],
  }
}
