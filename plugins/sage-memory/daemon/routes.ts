import type { ServerResponse } from 'node:http'
import type { AuditEntry, BackfillFilter, Candidate, Decision, Memory, ProposeInput, RememberInput, RememberResult, UpdatePatch, UpdateResult } from '../hooks/shared/model.ts'
import { accept, listCandidates, propose, reject, resolve } from './candidates.ts'
import { markReminded } from './contexts.ts'
import { recordJudged, recordReminder, recordUse } from './counters.ts'
import type { Embeddings } from './embeddings.ts'
import { dropMemory, insertMoved, movedMemory, removeMoved } from './move.ts'
import { storeLabel, type Op } from './op.ts'
import { candidateStore, memoryStore, opFor, placesOf, storeForScope, type Places } from './places.ts'
import { backfill, recoverMemory } from './recover.ts'
import { datedMemories, redateFailed, redateMemory, type RedateRequest } from './redate.ts'
import { refused } from './errors.ts'
import { liveIds, remember, supersede } from './remember.ts'
import { longMemories, replaceMemory, shortenFailed, type ReplaceRequest, type ReplaceResult } from './replace.ts'
import { clear, deleteMemory, forget } from './remove.ts'
import { flag, optionalCount, projectOf, optionalObject, optionalScope, optionalString, requiredObject, requiredString, stringList, type Body } from './request.ts'
import { readAudit, readMemory } from './rows.ts'
import { transaction, type Store, type Stores } from './stores.ts'
import { updateMemory, type UpdateRequest } from './update.ts'
import { pluginVersion } from './version.ts'

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

/** Runs `work` as `run` does, then embeds the memory it answers, after the commit and outside the transaction. */
async function write<T extends object>(stores: Stores, embeddings: Embeddings, body: Body, pick: (places: Places) => Store, work: (op: Op) => T): Promise<T> {
  const places = placesOf(stores, body)
  const store = pick(places)
  const result = await transaction(store, () => work(opFor(places, store)))
  const memory = (result as { memory?: Memory }).memory
  if (memory !== undefined) await embeddings.afterWrite(store, [memory])
  return result
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

/**
 * Moves a memory to the store of the scope its patch names; `move.ts` holds the steps. A failed
 * removal from the source takes the copy out of the target again. Replacing memories in the target
 * waits until the source is clear, so a failed move leaves the target as it was.
 */
async function moveMemory(places: Places, from: Store, to: Store, request: UpdateRequest, embeddings: Embeddings): Promise<UpdateResult> {
  const source = opFor(places, from)
  const target = opFor(places, to)
  const memory = await transaction(from, () => movedMemory(source, target, request))
  await transaction(to, () => insertMoved(target, memory, storeLabel(from), request.sessionId))
  try {
    await transaction(from, () => removeMoved(source, memory, storeLabel(to), request.sessionId))
  } catch (error) {
    await transaction(to, () => dropMemory(target, memory.id))
    throw error
  }
  const superseded = await transaction(to, () => supersede(target, memory, memory.supersedes ?? []))
  await embeddings.afterWrite(to, [memory])
  return { memory, superseded }
}

/** Updates a memory in its store, or moves it when the patch names the other store's scope. */
function updateOrMove(stores: Stores, embeddings: Embeddings, body: Body): Promise<UpdateResult> {
  const request: UpdateRequest = { id: requiredString(body, 'id'), patch: requiredObject<UpdatePatch>(body, 'patch'), sessionId: sessionOf(body) }
  const places = placesOf(stores, body)
  const from = memoryStore(places, request.id)
  const scope = request.patch.scope
  const to = scope === 'project' || scope === 'user' ? storeForScope(places, scope) : from
  if (to !== from) return moveMemory(places, from, to, request, embeddings)
  return write(stores, embeddings, body, () => from, op => updateMemory(op, request))
}

/**
 * A remember with its meaning check: the text is embedded before the transaction, because an
 * inference cannot run inside one, and while embeddings are not ready the check is skipped.
 */
async function rememberRoute(stores: Stores, embeddings: Embeddings, body: Body): Promise<RememberResult> {
  const input = requiredObject<RememberInput>(body, 'input')
  const pick = (places: Places): Store => storeForScope(places, input.scope)
  const semantic = input.distinct === true || typeof input.text !== 'string' ? undefined : await embeddings.semantic(input.text, [pick(placesOf(stores, body))])
  return write(stores, embeddings, body, pick, op => remember(op, input, semantic))
}

/** Replaces a memory with shorter ones in the store that holds it, then embeds the parts. */
async function replaceRoute(stores: Stores, embeddings: Embeddings, body: Body): Promise<ReplaceResult> {
  const revision = optionalCount(body, 'revision', Number.MAX_SAFE_INTEGER)
  if (revision === undefined) throw refused('revision is required: the revision of the memory as it was read')
  const request: ReplaceRequest = { id: requiredString(body, 'id'), revision, texts: stringList(body, 'texts'), sessionId: sessionOf(body) }
  const places = placesOf(stores, body)
  const store = memoryStore(places, request.id)
  const result = await transaction(store, () => replaceMemory(opFor(places, store), request))
  await embeddings.afterWrite(store, result.parts)
  return result
}

/** Rewrites a memory's text without its write days in the store that holds it, then embeds it again. */
function redateRoute(stores: Stores, embeddings: Embeddings, body: Body): Promise<{ memory: Memory }> {
  const revision = optionalCount(body, 'revision', Number.MAX_SAFE_INTEGER)
  if (revision === undefined) throw refused('revision is required: the revision of the memory as it was read')
  const request: RedateRequest = { id: requiredString(body, 'id'), revision, text: requiredString(body, 'text'), sessionId: sessionOf(body) }
  return write(stores, embeddings, body, places => memoryStore(places, request.id), op => ({ memory: redateMemory(op, request) }))
}

/**
 * How long a long memory handed to one window is kept from the others: one daemon serves every
 * window, and a rewrite took up to 25.9 s (two tries of the longest note measured), so ten minutes
 * covers a slow job model and still frees the memory of a window that closed mid-rewrite.
 */
const LEASE_MS = 10 * 60_000

/** A query for the memories a rewrite job works on: at most `limit`, without those `held` names. */
type Finder = (op: Op, limit: number, version: string, held: (id: string) => boolean) => Memory[]

/** The memories of both stores `find` answers that no other window holds, each held for this one for `LEASE_MS`. */
async function lease(stores: Stores, leases: Map<string, number>, version: string, body: Body, find: Finder): Promise<Memory[]> {
  const limit = optionalCount(body, 'limit', 1000) ?? 50
  const now = Date.now()
  const held = (id: string): boolean => (leases.get(id) ?? 0) > now
  const found = await both(stores, body, op => find(op, limit, version, held))
  const memories = [...found.project, ...found.user].slice(0, limit)
  for (const memory of memories) leases.set(memory.id, now + LEASE_MS)
  for (const [id, until] of leases) if (until <= now) leases.delete(id)
  return memories
}

export function memoryRoutes(stores: Stores, embeddings: Embeddings): Routes {
  const leases = new Map<string, number>()
  // The version the daemon started with: a failed rewrite counts against it alone.
  const version = pluginVersion()
  const post =(handle: (body: Body) => unknown): Route => ({ method: 'POST', auth: true, handle: ({ body }) => handle(body) })
  const byId = (body: Body): ((places: Places) => Store) => places => memoryStore(places, requiredString(body, 'id'))
  return {
    '/memory/remember': post(body => rememberRoute(stores, embeddings, body)),
    '/memory/get': post(body => run(stores, body, byId(body), op => readMemory(op.store.db, requiredString(body, 'id')))),
    '/memory/update': post(body => updateOrMove(stores, embeddings, body)),
    '/memory/replace': post(body => replaceRoute(stores, embeddings, body)),
    '/memory/long': post(body => lease(stores, leases, version, body, longMemories)),
    '/project/owner': post(body => stores.owner(projectOf(body))),
    '/memory/live': post(body => {
      const scope = optionalScope(body) ?? 'project'
      return run(stores, body, places => storeForScope(places, scope), op => liveIds(op, stringList(body, 'ids')))
    }),
    '/memory/dated': post(body => lease(stores, leases, version, body, datedMemories)),
    '/memory/redate': post(body => redateRoute(stores, embeddings, body)),
    '/memory/redate-failed': post(body =>
      run(stores, body, byId(body), op => {
        redateFailed(op, { id: requiredString(body, 'id'), reason: requiredString(body, 'reason'), version, sessionId: sessionOf(body) })
        leases.delete(requiredString(body, 'id'))
        return { recorded: true }
      }),
    ),
    '/memory/shorten-failed': post(body =>
      run(stores, body, byId(body), op => {
        shortenFailed(op, { id: requiredString(body, 'id'), reason: requiredString(body, 'reason'), version, sessionId: sessionOf(body) })
        leases.delete(requiredString(body, 'id'))
        return { recorded: true }
      }),
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
      write(stores, embeddings, body, byId(body), op => recoverMemory(op, { id: requiredString(body, 'id'), reason: optionalString(body, 'reason'), sessionId: sessionOf(body) })),
    ),
    '/memory/backfill': post(body => both(stores, body, op => backfill(op, { filter: optionalObject<BackfillFilter>(body, 'filter'), apply: flag(body, 'apply') }))),
    ...counterRoutes(stores, post),
    ...candidateRoutes(stores, embeddings, post),
    '/audit': post(async body => {
      const limit = optionalCount(body, 'limit', 1000) ?? 50
      const logs = await both(stores, body, op => readAudit(op.store.db, limit))
      return [...logs.project, ...logs.user].sort((a: AuditEntry, b: AuditEntry) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit)
    }),
  }
}

type Post = (handle: (body: Body) => unknown) => Route

/**
 * Counts reminders and uses in the store that holds each id: the project's, the user's, or a project
 * store above or below it, whose memories a session is reminded of too; an id held by none is skipped.
 */
function counterRoutes(stores: Stores, post: Post): Routes {
  const count = async (body: Body, record: (op: Op, ids: string[]) => void): Promise<{ counted: number; held: string[] }> => {
    const places = placesOf(stores, body)
    let left = stringList(body, 'ids')
    const held: string[] = []
    for (const store of [places.project, places.global, ...places.nested()]) {
      const own = left.filter(id => readMemory(store.db, id) !== undefined)
      if (own.length === 0) continue
      await transaction(store, () => record(opFor(places, store), own))
      held.push(...own)
      left = left.filter(id => !own.includes(id))
    }
    return { counted: held.length, held }
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
    // The verdict of one turn lands in the project's log, whichever store holds each memory.
    '/memory/judged': post(body => run(stores, body, places => places.project, op => recordJudged(op, stringList(body, 'judged'), stringList(body, 'followed'), sessionOf(body), optionalObject<Record<string, unknown>>(body, 'evidence')))),
  }
}

function candidateRoutes(stores: Stores, embeddings: Embeddings, post: Post): Routes {
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
    '/candidates/accept': post(body => write(stores, embeddings, body, byId(body), op => accept(op, requiredString(body, 'id')))),
    '/candidates/reject': post(body => run(stores, body, byId(body), op => ({ rejected: reject(op, { id: requiredString(body, 'id'), reason: optionalString(body, 'reason') ?? 'rejected' }) }))),
    '/candidates/resolve': post(body =>
      run(stores, body, byId(body), op => resolve(op, { id: requiredString(body, 'id'), decision: requiredString(body, 'decision') as Decision, reason: optionalString(body, 'reason') })),
    ),
  }
}
