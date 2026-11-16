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
export type Places = { project: Store; global: Store; root: string; now: string; nested: () => Store[] }

export function placesOf(stores: Stores, body: Body): Places {
  const ref = projectOf(body)
  let nested: Store[] | undefined
  return { project: stores.project(ref), global: stores.global(), root: ref.root, now: new Date().toISOString(), nested: () => (nested ??= stores.nested(ref)) }
}

/**
 * An operation on one of the places: the global store takes no project root, since it holds no path;
 * a store above or below the project takes its own root, in which its anchors are written.
 */
export function opFor(places: Places, store: Store): Op {
  if (store === places.global) return { store, root: undefined, now: places.now }
  return { store, root: store === places.project ? places.root : (store.root ?? places.root), now: places.now }
}

export function storeForScope(places: Places, scope: Scope | undefined): Store {
  return scope === 'user' ? places.global : places.project
}

/** The store that holds an id: the project's, the user's, then one of the projects above or below it, whose memories a session also sees. */
function holding(places: Places, id: string, has: (store: Store) => boolean, what: string): Store {
  if (has(places.project)) return places.project
  if (has(places.global)) return places.global
  const nested = places.nested().find(has)
  if (nested !== undefined) return nested
  throw notFound(`no ${what} ${id} in the project store, the user store or a project store above or below it`)
}

export function memoryStore(places: Places, id: string): Store {
  return holding(places, id, store => readMemory(store.db, id) !== undefined, 'memory')
}

export function candidateStore(places: Places, id: string): Store {
  return holding(places, id, store => readCandidate(store.db, id) !== undefined, 'candidate')
}
