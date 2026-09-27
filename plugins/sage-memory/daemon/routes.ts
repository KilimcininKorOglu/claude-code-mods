import type { ServerResponse } from 'node:http'
import type { AuditEntry, BackfillFilter, Candidate, Decision, ProposeInput, RememberInput, UpdatePatch } from '../hooks/shared/model.ts'
import { accept, listCandidates, propose, reject, resolve } from './candidates.ts'
import { markReminded } from './contexts.ts'
import { recordReminder, recordUse } from './counters.ts'
import type { Op } from './op.ts'
import { candidateStore, memoryStore, opFor, placesOf, storeForScope, type Places } from './places.ts'
import { backfill, recoverMemory } from './recover.ts'
import { remember } from './remember.ts'
import { clear, deleteMemory, forget } from './remove.ts'
import { flag, optionalCount, optionalObject, optionalScope, optionalString, requiredObject, requiredString, stringList, type Body } from './request.ts'
import { readAudit, readMemory } from './rows.ts'
import { transaction, type Store, type Stores } from './stores.ts'
import { updateMemory } from './update.ts'

export type RouteInput = { body: Body; res: ServerResponse }
export type Route = { method: 'GET' | 'POST'; auth: boolean; handle: (input: RouteInput) => unknown }
export type Routes = Record<string, Route>

/** The memory routes that write. Every request names its project; see `places.ts` for the store each reaches. */

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
      const scope = optionalScope(body) ?? 'project'
      return run(stores, body, places => storeForScope(places, scope), op => forget(op, { query: requiredString(body, 'query'), scope, force: flag(body, 'force'), sessionId: sessionOf(body) }))
    }),
    '/memory/clear': post(body => {
      const scope = optionalScope(body)
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
  const count = async (body: Body, record: (op: Op, ids: string[]) => void): Promise<{ counted: number; held: string[] }> => {
    const ids = stringList(body, 'ids')
    const held = await both(stores, body, op => {
      const own = ids.filter(id => readMemory(op.store.db, id) !== undefined)
      if (own.length > 0) record(op, own)
      return own
    })
    return { counted: held.project.length + held.user.length, held: [...held.project, ...held.user] }
  }
  const reminded = async (body: Body): Promise<{ counted: number }> => {
    const trigger = requiredString(body, 'trigger')
    const loop = optionalString(body, 'loop')
    const sessionId = sessionOf(body)
    const { counted, held } = await count(body, (op, ids) => recordReminder(op, ids, trigger, sessionId))
    if (loop !== undefined && sessionId !== undefined && held.length > 0) {
      await run(stores, body, places => places.project, op => markReminded(op, { sessionId, loop, ids: held, trigger }))
    }
    return { counted }
  }
  return {
    '/memory/reminded': post(reminded),
    '/memory/used': post(async body => ({ counted: (await count(body, (op, ids) => recordUse(op, ids, requiredString(body, 'source'), sessionOf(body)))).counted })),
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
