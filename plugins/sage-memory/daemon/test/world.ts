import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Memory, RememberInput, RememberResult } from '../../hooks/shared/model.ts'
import type { ProjectRef } from '../../hooks/shared/protocol.ts'
import type { Op } from '../op.ts'
import { remember } from '../remember.ts'
import { readMemory, sql } from '../rows.ts'
import { createStores, transaction, type Store, type Stores } from '../stores.ts'
import { tempDir } from './support.ts'

/**
 * A memory world for tests: a data directory with a project store and the global store, and a
 * project root with a few files anchors can name. Each operation runs in its own transaction at
 * the next tick of a test clock, so every write has a later time than the one before.
 */
export type World = {
  root: string
  stores: Stores
  project: Store
  global: Store
  /** Runs `work` in one transaction of `store` (the project's by default). */
  run: <T>(work: (op: Op) => T, store?: Store) => Promise<T>
  remember: (input: RememberInput, store?: Store) => Promise<RememberResult>
  read: (id: string, store?: Store) => Memory
  edges: (store?: Store) => string[]
  close: () => void
}

export function world(): World {
  const base = tempDir()
  const root = join(base, 'repo')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.ts'), 'export function main() {}\n')
  const ref: ProjectRef = { key: 'repo-0000aaaa', name: 'repo', root, commonDir: join(root, '.git') }
  const stores = createStores(join(base, 'data'))
  const project = stores.project(ref)
  const global = stores.global()
  let tick = Date.parse('2026-09-01T00:00:00.000Z')
  const run = <T>(work: (op: Op) => T, store: Store = project): Promise<T> => {
    tick += 1000
    const now = new Date(tick).toISOString()
    return transaction(store, () => work({ store, root: store === global ? undefined : root, now }))
  }
  const read = (id: string, store: Store = project): Memory => {
    const memory = readMemory(store.db, id)
    if (!memory) throw new Error(`no memory ${id}`)
    return memory
  }
  const edges = (store: Store = project): string[] => {
    const rows = sql(store.db as DatabaseSync, 'SELECT from_node, to_node, relation FROM edges ORDER BY from_node, to_node, relation').all() as Array<{ from_node: string; to_node: string; relation: string }>
    return rows.map(row => `${row.from_node} ${row.relation} ${row.to_node}`)
  }
  return {
    root,
    stores,
    project,
    global,
    run,
    remember: (input, store) => run(op => remember(op, input), store),
    read,
    edges,
    close: () => stores.closeAll(),
  }
}
