import { dirname, join } from 'node:path'
import type { Memory, VerifyReport } from '../hooks/shared/model.ts'
import { conflict } from './errors.ts'
import { mustRead, type Op } from './op.ts'
import { memoryStore, opFor, placesOf, type Places } from './places.ts'
import { optionalString, stringList, type Body } from './request.ts'
import { memoriesAnchoredTo, relativePaths } from './retrieve.ts'
import type { Route, Routes } from './routes.ts'
import { selectMemories } from './rows.ts'
import { EVERY_POLICY } from './search.ts'
import type { Store, Stores } from './stores.ts'
import { writeVerifications } from './verdicts.ts'
import { verifyMemories, type VerifyScope } from './verify.ts'

/**
 * The routes that keep the stores true to the project: verifying anchors, on request and after a
 * file changed. A check reads the project and writes what it found in slices.
 */

export type UpkeepContext = { dir: string; stores: Stores }

/** The most memories one changed path verifies. */
const PATH_VERIFY_LIMIT = 500

const ANCHORED = "SELECT id, data FROM memories WHERE status != 'deleted' AND json_array_length(data, '$.anchors') > 0 ORDER BY id"

/**
 * Where a store's anchors are read from. An agent type is looked up in the user's agents
 * directory beside the daemon's own, and for a project also in its `.claude/agents`.
 */
function scopeOf(context: UpkeepContext, places: Places, store: Store): VerifyScope {
  const userAgents = join(dirname(context.dir), 'agents')
  if (store === places.global) return { root: undefined, agentDirs: [userAgents] }
  return { root: places.root, agentDirs: [join(places.root, '.claude', 'agents'), userAgents] }
}

/** Checks the memories of one store at the git depth and writes what the checks found. */
async function verifyIn(context: UpkeepContext, places: Places, store: Store, memories: readonly Memory[]): Promise<VerifyReport> {
  const op: Op = opFor(places, store)
  const checks = await verifyMemories(scopeOf(context, places, store), memories, 'git', op.now)
  const applied = await writeVerifications(op, checks)
  return { results: checks.map(check => check.result), staled: applied.staled, reactivated: applied.reactivated }
}

function joined(reports: readonly VerifyReport[]): VerifyReport {
  return {
    results: reports.flatMap(report => report.results),
    staled: reports.flatMap(report => report.staled),
    reactivated: reports.flatMap(report => report.reactivated),
  }
}

/** One memory by its id, or every memory with an anchor in both stores. */
async function verify(context: UpkeepContext, body: Body): Promise<VerifyReport> {
  const places = placesOf(context.stores, body)
  const id = optionalString(body, 'id')
  if (id === undefined) {
    const project = await verifyIn(context, places, places.project, selectMemories(places.project.db, ANCHORED))
    return joined([project, await verifyIn(context, places, places.global, selectMemories(places.global.db, ANCHORED))])
  }
  const store = memoryStore(places, id)
  const memory = mustRead(opFor(places, store), id)
  if (memory.status === 'deleted') throw conflict(`${id} is deleted; recover it before verifying it`)
  return verifyIn(context, places, store, [memory])
}

/** The active and stale memories anchored to files that just changed, checked again. */
async function verifyPaths(context: UpkeepContext, body: Body): Promise<VerifyReport> {
  const places = placesOf(context.stores, body)
  const paths = relativePaths(places.root, stringList(body, 'paths'))
  const visibility = { statuses: ['active', 'stale'] as const, policies: EVERY_POLICY, audienceScoped: true, allSessions: true }
  const memories = memoriesAnchoredTo(opFor(places, places.project), paths, visibility, PATH_VERIFY_LIMIT)
  return verifyIn(context, places, places.project, memories)
}

export function upkeepRoutes(context: UpkeepContext): Routes {
  const post = (handle: (body: Body) => unknown): Route => ({ method: 'POST', auth: true, handle: ({ body }) => handle(body) })
  return {
    '/memory/verify': post(body => verify(context, body)),
    '/memory/verify-paths': post(body => verifyPaths(context, body)),
  }
}
