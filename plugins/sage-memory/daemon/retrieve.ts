import type { Audience, Memory } from '../hooks/shared/model.ts'
import { RequestError } from './errors.ts'
import type { Op } from './op.ts'
import { ancestorPaths, projectPath } from './paths.ts'
import { selectMemories, sql } from './rows.ts'
import { searchStore, visibilityParams, type Visibility } from './search.ts'

/** Memories found by where they point: a path and the directories above it, an audience, the `always` policy. */

type IdRow = { id: string }

/** The memories with an `about_*` edge into one of the listed nodes. */
export const ABOUT_NODES = `
  SELECT DISTINCT substr(from_node, 5) AS id FROM edges
  WHERE to_node IN (SELECT value FROM json_each(?)) AND relation GLOB 'about_*' AND from_node GLOB 'mem:*'`

/** The memories with an `about_symbol` edge into one file: every node from `symbol:<path>#` up to `symbol:<path>$`. */
const ABOUT_SYMBOLS = `
  SELECT DISTINCT substr(from_node, 5) AS id FROM edges
  WHERE to_node >= ? AND to_node < ? AND relation = 'about_symbol' AND from_node GLOB 'mem:*'`

const AMONG_IDS = `
  SELECT m.id AS id, m.data AS data FROM memories m
  WHERE m.id IN (SELECT value FROM json_each(?))
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)
  ORDER BY m.importance DESC, m.updated_at DESC
  LIMIT ?`

/** The visible memories among `ids`, most important first. */
export function memoriesAmong(op: Op, ids: Iterable<string>, visibility: Visibility, limit: number): Memory[] {
  return selectMemories(op.store.db, AMONG_IDS, JSON.stringify([...ids]), ...visibilityParams(visibility), limit)
}

/** Paths relative to the project root; a path outside it is left out, since no anchor can name it. */
export function relativePaths(root: string, paths: readonly string[]): string[] {
  const relative = new Set<string>()
  for (const path of paths) {
    try {
      relative.add(projectPath(root, path))
    } catch (err) {
      if (!(err instanceof RequestError && err.status === 400)) throw err
    }
  }
  return [...relative]
}

/**
 * The memories anchored to one of the paths, to a symbol in it, or to a directory above it, most
 * important first. The paths are relative to the project root.
 */
export function memoriesForPaths(op: Op, relPaths: readonly string[], visibility: Visibility, limit: number): Memory[] {
  if (relPaths.length === 0) return []
  const nodes = relPaths.flatMap(path => ancestorPaths(path).flatMap(level => [`file:${level}`, `dir:${level}`]))
  const ids = new Set((sql(op.store.db, ABOUT_NODES).all(JSON.stringify(nodes)) as IdRow[]).map(row => row.id))
  for (const path of relPaths) {
    for (const row of sql(op.store.db, ABOUT_SYMBOLS).all(`symbol:${path}#`, `symbol:${path}$`) as IdRow[]) ids.add(row.id)
  }
  return memoriesAmong(op, ids, visibility, limit)
}

export type AudienceContext = { role?: string; mode?: string }

function contextValue(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLowerCase()
}

/** Every field the audience fills must name the context's value; an empty field takes any value. */
function matchesAudience(audience: Audience | undefined, role: string, mode: string): boolean {
  if (!audience) return false
  if (audience.roles && audience.roles.length > 0 && !audience.roles.includes(role)) return false
  return !(audience.modes && audience.modes.length > 0 && !audience.modes.includes(mode))
}

const WITH_AUDIENCE = `
  SELECT m.id AS id, m.data AS data FROM memories m
  WHERE m.audience IS NOT NULL
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)
  ORDER BY m.importance DESC, m.updated_at DESC
  LIMIT ? OFFSET ?`

/** The most rows one audience lookup reads, however rare the matching audience is. */
const MAX_AUDIENCE_SCAN = 10_000

/**
 * The active memories written for this subagent role or permission mode, most important first.
 * The rows are read in growing windows (5, then 15, then 45 times the limit) until the limit is
 * filled or 10,000 rows were read.
 */
export function memoriesForAudience(op: Op, context: AudienceContext, sessionId: string | undefined, limit: number): Memory[] {
  const visibility: Visibility = { statuses: ['active'], policies: ['auto', 'always'], audienceScoped: true, sessionId }
  const params = visibilityParams(visibility)
  const role = contextValue(context.role)
  const mode = contextValue(context.mode)
  const matched: Memory[] = []
  let offset = 0
  let window = limit * 5
  while (matched.length < limit && offset < MAX_AUDIENCE_SCAN) {
    const size = Math.min(window, MAX_AUDIENCE_SCAN - offset)
    const rows = selectMemories(op.store.db, WITH_AUDIENCE, ...params, size, offset)
    matched.push(...rows.filter(memory => matchesAudience(memory.audience, role, mode)))
    if (rows.length < size) break
    offset += size
    window *= 3
  }
  return matched.slice(0, limit)
}

/** The active memories the person marked `always`, written for no audience, most important first. */
export function alwaysMemories(op: Op, sessionId: string | undefined, limit: number): Memory[] {
  return searchStore(op.store.db, '', { statuses: ['active'], policies: ['always'], audienceScoped: false, sessionId }, limit)
}
