import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { ContextPolicy, Memory, Scope, Status } from '../hooks/shared/model.ts'
import { ftsTerms } from './fts.ts'
import { selectMemories } from './rows.ts'

/**
 * Which memories a read may see. A session reads its own session memories and no other
 * session's; the person (a command or the pane) reads every session's. A memory written for an
 * audience is left out of every read that does not ask for it.
 */
export type Visibility = {
  statuses: readonly Status[]
  policies: readonly ContextPolicy[]
  audienceScoped: boolean
  sessionId?: string
  allSessions?: boolean
  scope?: Scope
}

export const EVERY_POLICY: readonly ContextPolicy[] = ['never', 'auto', 'always']

/** The context policy an automatic reminder may carry: `never` is kept out, and `always` has its own block. */
export const REMINDED_POLICY: readonly ContextPolicy[] = ['auto']

/**
 * The parameters of the visibility clause every read query below ends its WHERE clause with:
 * statuses, policies, scope, sessions and audience, in that order.
 */
export function visibilityParams(visibility: Visibility): SQLInputValue[] {
  const scope = visibility.scope ?? null
  return [
    JSON.stringify(visibility.statuses),
    JSON.stringify(visibility.policies),
    scope,
    scope,
    visibility.allSessions === true ? 1 : 0,
    visibility.sessionId ?? null,
    visibility.audienceScoped ? 1 : 0,
  ]
}

const BY_RANK = `
  SELECT m.id AS id, m.data AS data FROM memories m
  WHERE m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)
  ORDER BY m.importance DESC, m.updated_at DESC
  LIMIT ?`

/**
 * `memories_fts` first and a CROSS JOIN, so the MATCH drives the scan and `memories` is read by
 * rowid; SAGE measured the other join order at seconds against milliseconds.
 */
const BY_TEXT = `
  SELECT m.id AS id, m.data AS data FROM memories_fts f CROSS JOIN memories m ON m.rowid = f.rowid
  WHERE memories_fts MATCH ?
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)
  ORDER BY bm25(memories_fts), m.importance DESC
  LIMIT ?`

/**
 * The memories of one store that match a free-text query, best match first: every term first,
 * any term when that finds nothing. A blank query lists the most important memories; a query
 * with no searchable term finds nothing.
 */
export function searchStore(db: DatabaseSync, query: string, visibility: Visibility, limit: number): Memory[] {
  const params = visibilityParams(visibility)
  if (query.trim() === '') return selectMemories(db, BY_RANK, ...params, limit)
  const terms = ftsTerms(query)
  if (terms.length === 0) return []
  const every = selectMemories(db, BY_TEXT, terms.join(' '), ...params, limit)
  if (every.length > 0 || terms.length === 1) return every
  return selectMemories(db, BY_TEXT, terms.join(' OR '), ...params, limit)
}

/**
 * Two ranked lists as one: rank by rank, the first list first at each rank, each memory once.
 * This is reciprocal-rank fusion with equal weights, so neither store outranks the other.
 */
export function interleave<T extends { id: string }>(first: readonly T[], second: readonly T[]): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    for (const item of [first[i], second[i]]) {
      if (item === undefined || seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}
