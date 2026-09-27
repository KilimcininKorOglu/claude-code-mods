import { STATUSES, type FileMemories, type GatheredPage, type GraphEdge, type Memory, type Scope, type SearchHit, type Status } from '../hooks/shared/model.ts'
import { refused } from './errors.ts'
import { fileMatches, groupFileMatches } from './for-file.ts'
import { listPage, storeStats, type ListOptions } from './listing.ts'
import { opFor, placesOf, type Places } from './places.ts'
import { findRelated, graphFor } from './related.ts'
import { flag, flagOr, optionalCount, optionalKind, optionalScope, optionalString, optionalText, requiredString, statusList, stringList, type Body } from './request.ts'
import { memoriesForPaths, relativePaths } from './retrieve.ts'
import type { Route, Routes } from './routes.ts'
import { EVERY_POLICY, interleave, searchStore, type Visibility } from './search.ts'
import type { Store, Stores } from './stores.ts'

/**
 * The routes that read: search, the memories about a path or a file, the graph, listings and
 * counts. None of them writes. A read a session makes sees its own session memories alone; the
 * person's reads may ask for every session's with `allSessions`.
 */

const LISTED_STATUSES: readonly Status[] = ['active', 'stale', 'superseded', 'contradicted', 'archived']

/** The policies an explicit read that SAGE served as automatic context leaves `never` out of. */
const SHOWN_POLICIES = ['auto', 'always'] as const

/** At most this many memories of a gathered page get their graph edges. */
const GATHER_GRAPH_SCAN = 10

function readerVisibility(body: Body, statuses: readonly Status[]): Visibility {
  return { statuses, policies: EVERY_POLICY, audienceScoped: true, sessionId: optionalString(body, 'sessionId'), allSessions: flag(body, 'allSessions') }
}

/** Both stores' hits merged rank by rank; with one channel, a hit's score is its place in the list. */
function search(stores: Stores, body: Body): SearchHit[] {
  const places = placesOf(stores, body)
  const query = optionalText(body, 'query')
  const limit = optionalCount(body, 'limit', 100) ?? 20
  const visibility = readerVisibility(body, flag(body, 'includeStale') ? ['active', 'stale'] : ['active'])
  const merged = interleave(searchStore(places.project.db, query, visibility, limit), searchStore(places.global.db, query, visibility, limit)).slice(0, limit)
  return merged.map((memory, index) => {
    const lexicalScore = merged.length <= 1 ? 1 : 1 - index / (merged.length - 1)
    return { memory, lexicalScore, vectorScore: null, finalScore: lexicalScore, source: 'lexical' as const }
  })
}

function forPath(stores: Stores, body: Body): Memory[] {
  const places = placesOf(stores, body)
  const paths = relativePaths(places.root, [requiredString(body, 'path')])
  return memoriesForPaths(opFor(places, places.project), paths, readerVisibility(body, ['active', 'stale']), optionalCount(body, 'limit', 50) ?? 20)
}

function forFile(stores: Stores, body: Body): FileMemories {
  const places = placesOf(stores, body)
  const [target] = relativePaths(places.root, [requiredString(body, 'path')])
  if (target === undefined) throw refused('the path is outside the project root')
  const options = {
    lineStart: optionalCount(body, 'lineStart', Number.MAX_SAFE_INTEGER),
    lineEnd: optionalCount(body, 'lineEnd', Number.MAX_SAFE_INTEGER),
    limit: optionalCount(body, 'limit', 250) ?? 50,
    includeSuperseded: flagOr(body, 'showSuperseded', true),
    includeDeleted: flag(body, 'showDeleted'),
    sessionId: optionalString(body, 'sessionId'),
    allSessions: flag(body, 'allSessions'),
  }
  const matches = [places.project, places.global].flatMap(store => fileMatches(opFor(places, store), target, options))
  return groupFileMatches(target, matches, options.limit)
}

function graph(stores: Stores, body: Body): GraphEdge[] {
  const places = placesOf(stores, body)
  const query = requiredString(body, 'query')
  const depth = optionalCount(body, 'depth', 6) ?? 2
  const limit = optionalCount(body, 'limit', 500) ?? 100
  const visibility = { ...readerVisibility(body, ['active']), policies: SHOWN_POLICIES }
  return [places.project, places.global].flatMap(store => graphFor(opFor(places, store), query, visibility, depth, limit)).slice(0, limit)
}

function related(stores: Stores, body: Body): Memory[] {
  const places = placesOf(stores, body)
  const ids = stringList(body, 'ids')
  const limit = optionalCount(body, 'limit', 100) ?? 20
  const options = { visibility: { ...readerVisibility(body, statusList(body, 'statuses', ['active'])), policies: SHOWN_POLICIES }, limit, maxDepth: optionalCount(body, 'depth', 6) ?? 3 }
  const [project, user] = [places.project, places.global].map(store => findRelated(opFor(places, store), ids, options))
  return interleave(project ?? [], user ?? []).slice(0, limit)
}

function listOptions(body: Body): ListOptions {
  return {
    statuses: statusList(body, 'statuses', LISTED_STATUSES),
    kind: optionalKind(body),
    query: optionalString(body, 'query'),
    scope: optionalScope(body),
    limit: optionalCount(body, 'limit', 500) ?? 50,
    cursor: optionalString(body, 'cursor'),
    sessionId: optionalString(body, 'sessionId'),
    allSessions: flag(body, 'allSessions'),
  }
}

/** A listing without a scope reads both stores; with one, the store that holds it. */
function storesFor(places: Places, scope: Scope | undefined): Store[] {
  if (scope === undefined) return [places.project, places.global]
  return [scope === 'user' ? places.global : places.project]
}

/** The graph edges of the page's first memories, each edge once. */
function pageRelations(places: Places, memories: readonly Memory[]): GraphEdge[] {
  const seen = new Set<string>()
  const relations: GraphEdge[] = []
  const visibility: Visibility = { statuses: STATUSES, policies: EVERY_POLICY, audienceScoped: true, allSessions: true }
  for (const memory of memories) {
    const store = memory.scope === 'user' ? places.global : places.project
    for (const edge of graphFor(opFor(places, store), memory.id, visibility, 1, 100)) {
      const key = `${edge.from}\0${edge.to}\0${edge.relation}`
      if (seen.has(key)) continue
      seen.add(key)
      relations.push(edge)
    }
  }
  return relations
}

function gather(stores: Stores, body: Body): GatheredPage {
  const places = placesOf(stores, body)
  const options = listOptions(body)
  const page = listPage(storesFor(places, options.scope).map(store => store.db), options)
  if (!flagOr(body, 'includeRelations', true)) return { ...page, relations: [], relationsScanned: 0 }
  const scanned = page.memories.slice(0, GATHER_GRAPH_SCAN)
  return { ...page, relations: pageRelations(places, scanned), relationsScanned: scanned.length }
}

export function readRoutes(stores: Stores): Routes {
  const post = (handle: (body: Body) => unknown): Route => ({ method: 'POST', auth: true, handle: ({ body }) => handle(body) })
  return {
    '/memory/search': post(body => search(stores, body).map(hit => hit.memory)),
    '/memory/explain': post(body => search(stores, body)),
    '/memory/for-path': post(body => forPath(stores, body)),
    '/memory/for-file': post(body => forFile(stores, body)),
    '/memory/graph': post(body => graph(stores, body)),
    '/memory/related': post(body => related(stores, body)),
    '/memory/list': post(body => {
      const places = placesOf(stores, body)
      const options = listOptions(body)
      return listPage(storesFor(places, options.scope).map(store => store.db), options)
    }),
    '/memory/gather': post(body => gather(stores, body)),
    '/memory/stats': post(body => {
      const places = placesOf(stores, body)
      return { project: storeStats(places.project.db), user: storeStats(places.global.db) }
    }),
  }
}
