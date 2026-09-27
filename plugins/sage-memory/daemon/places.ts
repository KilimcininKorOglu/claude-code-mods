import type { Scope } from '../hooks/shared/model.ts'
import { notFound } from './errors.ts'
import type { Op } from './op.ts'
import { projectOf, type Body } from './request.ts'
import { readCandidate, readMemory } from './rows.ts'
import type { Store, Stores } from './stores.ts'

/**
 * The two stores a request reaches: its project's store holds the project, session, file and
 * symbol scopes, the global store the user scope. A route that takes an id finds the store that
 * holds it.
 */
export type Places = { project: Store; global: Store; root: string; now: string }

export function placesOf(stores: Stores, body: Body): Places {
  const ref = projectOf(body)
  return { project: stores.project(ref), global: stores.global(), root: ref.root, now: new Date().toISOString() }
}

/** An operation on one of the places; the global store takes no project root, since it holds no path. */
export function opFor(places: Places, store: Store): Op {
  return { store, root: store === places.global ? undefined : places.root, now: places.now }
}

export function storeForScope(places: Places, scope: Scope | undefined): Store {
  return scope === 'user' ? places.global : places.project
}

function holding(places: Places, id: string, has: (store: Store) => boolean, what: string): Store {
  if (has(places.project)) return places.project
  if (has(places.global)) return places.global
  throw notFound(`no ${what} ${id} in the project or the user store`)
}

export function memoryStore(places: Places, id: string): Store {
  return holding(places, id, store => readMemory(store.db, id) !== undefined, 'memory')
}

export function candidateStore(places: Places, id: string): Store {
  return holding(places, id, store => readCandidate(store.db, id) !== undefined, 'candidate')
}
