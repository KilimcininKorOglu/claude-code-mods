import type { Memory } from '../hooks/shared/model.ts'
import { forbidden, notFound } from './errors.ts'
import { readMemory } from './rows.ts'
import type { Store } from './stores.ts'

/**
 * What one operation runs against: the store, the project root its path anchors are relative to
 * (absent for the global store, whose memories take none), and the operation's time.
 */
export type Op = { store: Store; root: string | undefined; now: string }

/** The store a name is shown as in messages: `user` for the global store, `project` otherwise. */
export function storeLabel(store: Store): string {
  return store.name === 'global' ? 'user' : 'project'
}

export function mustRead(op: Op, id: string): Memory {
  const memory = readMemory(op.store.db, id)
  if (!memory) throw notFound(`no memory ${id} in the ${storeLabel(op.store)} store`)
  return memory
}

/**
 * Refuses a change to another session's session memory. A caller that names no session is the
 * person (a command or the pane), who may change any memory.
 */
export function checkOwner(memory: Memory, sessionId: string | undefined): void {
  if (sessionId === undefined || memory.scope !== 'session' || memory.ownerSessionId === sessionId) return
  throw forbidden(`${memory.id} is a session memory of another session, so this session cannot change it`)
}
