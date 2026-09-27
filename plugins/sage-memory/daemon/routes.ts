import type { ServerResponse } from 'node:http'
import { SCOPES, type AuditEntry, type BackfillFilter, type Candidate, type Decision, type ProposeInput, type RememberInput, type Scope, type UpdatePatch } from '../hooks/shared/model.ts'
import { accept, listCandidates, propose, reject, resolve } from './candidates.ts'
import { recordReminder, recordUse } from './counters.ts'
import { notFound, refused } from './errors.ts'
import type { Op } from './op.ts'
import { backfill, recoverMemory } from './recover.ts'
import { remember } from './remember.ts'
import { clear, deleteMemory, forget } from './remove.ts'
import { flag, optionalCount, optionalObject, optionalString, projectOf, requiredObject, requiredString, stringList, type Body } from './request.ts'
import { readAudit, readCandidate, readMemory } from './rows.ts'
import { transaction, type Store, type Stores } from './stores.ts'
import { updateMemory } from './update.ts'

export type RouteInput = { body: Body; res: ServerResponse }
export type Route = { method: 'GET' | 'POST'; auth: boolean; handle: (input: RouteInput) => unknown }
export type Routes = Record<string, Route>

/**
 * The memory routes. Every request names its project: the project's store holds the project,
 * session, file and symbol scopes, the global store the user scope. A route that takes an id finds
 * the store that holds it.
 */

type Places = { project: Store; global: Store; root: string; now: string }

function placesOf(stores: Stores, body: Body): Places {
  const ref = projectOf(body)
  return { project: stores.project(ref), global: stores.global(), root: ref.root, now: new Date().toISOString() }
}

function opFor(places: Places, store: Store): Op {
  return { store, root: store === places.global ? undefined : places.root, now: places.now }
}

function storeForScope(places: Places, scope: Scope | undefined): Store {
  return scope === 'user' ? places.global : places.project
}

function holding(places: Places, id: string, has: (store: Store) => boolean, what: string): Store {
  if (has(places.project)) return places.project
  if (has(places.global)) return places.global
  throw notFound(`no ${what} ${id} in the project or the user store`)
}

function memoryStore(places: Places, id: string): Store {
  return holding(places, id, store => readMemory(store.db, id) !== undefined, 'memory')
}

function candidateStore(places: Places, id: string): Store {
  return holding(places, id, store => readCandidate(store.db, id) !== undefined, 'candidate')
}

/** Runs `work` in one transaction of the store `pick` chooses. */
function run<T>(stores: Stores, body: Body, pick: (places: Places) => Store, work: (op: Op) => T): Promise<T> {
  const places = placesOf(stores, body)
  const store = pick(places)
  return transaction(store, () => work(opFor(places, store)))
}

/** Runs `work` on each store in turn, the project's first. */
async function both<T>(stores: Stores, body: Body, work: (op: Op) => T): Promise<{ project: T; user: T }> {
  const places = placesOf(stores, body)
  const project = await transaction(places.project, () => work(opFor(places, places.project)))
  const user = await transaction(places.global, () => work(opFor(places, places.global)))
  return { project, user }
}

function sessionOf(body: Body): string | undefined {
  return optionalString(body, 'sessionId')
}

function scopeOf(body: Body): Scope | undefined {
  const scope = optionalString(body, 'scope')
  if (scope !== undefined && !(SCOPES as readonly string[]).includes(scope)) throw refused(`scope must be one of: ${SCOPES.join(', ')}`)
  return scope as Scope | undefined
}

export function memoryRoutes(stores: Stores): Routes {
  const post = (handle: (body: Body) => unknown): Route => ({ method: 'POST', auth: true, handle: ({ body }) => handle(body) })
  const input = <T>(body: Body): T => requiredObject<T>(body, 'input')
  return {
    '/memory/remember': post(body => run(stores, body, places => storeForScope(places, input<RememberInput>(body).scope), op => remember(op, input<RememberInput>(body)))),
    '/memory/get': post(body => run(stores, body, places => memoryStore(places, requiredString(body, 'id')), op => readMemory(op.store.db, requiredString(body, 'id')))),
    '/memory/update': post(body =>
      run(stores, body, places => memoryStore(places, requiredString(body, 'id')), op =>
        updateMemory(op, { id: requiredString(body, 'id'), patch: requiredObject<UpdatePatch>(body, 'patch'), sessionId: sessionOf(body) }),
      ),
    ),
    '/memory/delete': post(body =>
      run(stores, body, places => memoryStore(places, requiredString(body, 'id')), op => ({
        deleted: deleteMemory(op, { id: requiredString(body, 'id'), reason: optionalString(body, 'reason') ?? 'deleted', force: flag(body, 'force'), neverRemind: flag(body, 'neverRemind'), sessionId: sessionOf(body) }),
      })),
    ),
    '/memory/forget': post(body => {
      const scope = scopeOf(body) ?? 'project'
      return run(stores, body, places => storeForScope(places, scope), op => forget(op, { query: requiredString(body, 'query'), scope, force: flag(body, 'force'), sessionId: sessionOf(body) }))
    }),
    '/memory/clear': post(body => {
      const scope = scopeOf(body)
      return run(stores, body, places => storeForScope(places, scope), op => clear(op, { scope, force: flag(body, 'force') }))
    }),
    '/memory/recover': post(body =>
      run(stores, body, places => memoryStore(places, requiredString(body, 'id')), op => recoverMemory(op, { id: requiredString(body, 'id'), reason: optionalString(body, 'reason'), sessionId: sessionOf(body) })),
    ),
    '/memory/backfill': post(body => both(stores, body, op => backfill(op, { filter: optionalObject<BackfillFilter>(body, 'filter'), apply: flag(body, 'apply') }))),
    ...counterRoutes(stores, post),
    ...candidateRoutes(stores, post),
    '/audit': post(async body => {
      const limit = optionalCount(body, 'limit', 1000) ?? 50
      const logs = await both(stores, body, op => readAudit(op.store.db, limit))
      return [...logs.project, ...logs.user].sort((a: AuditEntry, b: AuditEntry) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit)
    }),
  }
}

type Post = (handle: (body: Body) => unknown) => Route

/** Counts reminders and uses in the store that holds each id; an id held by neither is skipped. */
function counterRoutes(stores: Stores, post: Post): Routes {
  const count = async (body: Body, record: (op: Op, ids: string[]) => void): Promise<{ counted: number }> => {
    const ids = stringList(body, 'ids')
    const counted = await both(stores, body, op => {
      const held = ids.filter(id => readMemory(op.store.db, id) !== undefined)
      if (held.length > 0) record(op, held)
      return held.length
    })
    return { counted: counted.project + counted.user }
  }
  return {
    '/memory/reminded': post(body => count(body, (op, ids) => recordReminder(op, ids, requiredString(body, 'trigger'), sessionOf(body)))),
    '/memory/used': post(body => count(body, (op, ids) => recordUse(op, ids, requiredString(body, 'source'), sessionOf(body)))),
  }
}

function candidateRoutes(stores: Stores, post: Post): Routes {
  const byId = (body: Body): ((places: Places) => Store) => places => candidateStore(places, requiredString(body, 'id'))
  const proposeStore = (body: Body, places: Places): Store => {
    const proposal = requiredObject<ProposeInput>(body, 'input')
    return proposal.targetMemoryId === undefined ? storeForScope(places, proposal.scope) : memoryStore(places, proposal.targetMemoryId)
  }
  return {
    '/candidates/list': post(async body => {
      const lists = await both(stores, body, op => listCandidates(op, flag(body, 'includeResolved')))
      return [...lists.project, ...lists.user].sort((a: Candidate, b: Candidate) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    }),
    '/candidates/propose': post(body => run(stores, body, places => proposeStore(body, places), op => propose(op, requiredObject<ProposeInput>(body, 'input')))),
    '/candidates/accept': post(body => run(stores, body, byId(body), op => accept(op, requiredString(body, 'id')))),
    '/candidates/reject': post(body => run(stores, body, byId(body), op => ({ rejected: reject(op, { id: requiredString(body, 'id'), reason: optionalString(body, 'reason') ?? 'rejected' }) }))),
    '/candidates/resolve': post(body =>
      run(stores, body, byId(body), op => resolve(op, { id: requiredString(body, 'id'), decision: requiredString(body, 'decision') as Decision, reason: optionalString(body, 'reason') })),
    ),
  }
}
