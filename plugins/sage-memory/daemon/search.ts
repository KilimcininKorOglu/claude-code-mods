import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { ContextPolicy, Memory, Scope, Status } from '../hooks/shared/model.ts'
import { ftsTerms, MAX_TERMS, MIN_PREFIX } from './fts.ts'
import { selectMemories, sql } from './rows.ts'

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

export const EVERY_POLICY: readonly ContextPolicy[] = ['never', 'auto']

/** The context policy an automatic reminder may carry: `never` is kept out. */
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

const HELD = `
  SELECT EXISTS (
    SELECT 1 FROM memories_fts f CROSS JOIN memories m ON m.rowid = f.rowid
    WHERE memories_fts MATCH ?
      AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
      AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)
  ) AS held`

function isHeld(db: DatabaseSync, match: string, params: SQLInputValue[]): boolean {
  return Number((sql(db, HELD).get(match, ...params) as { held: number }).held) === 1
}

const HOLDER_COUNT = `
  SELECT COUNT(*) AS n FROM memories_fts f CROSS JOIN memories m ON m.rowid = f.rowid
  WHERE memories_fts MATCH ?
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

/** A query's terms in the form the store holds them, with how many visible memories hold each. */
export type HeldTerm = { term: string; count: number }

/**
 * The `MAX_TERMS` terms of a query the store holds, each in its held form, the rarest first: a term
 * fewer memories hold says more about which one the query means. Picked by rarity, not by place, so
 * the question at the end of a pasted log keeps its terms while the log's timestamps, which no memory
 * holds, take none. `unheld` counts the terms the store does not hold in any form.
 */
export function heldTerms(db: DatabaseSync, query: string, params: SQLInputValue[], column?: string): { terms: HeldTerm[]; unheld: number } {
  const forms = new Map<string, HeldTerm>()
  let unheld = 0
  for (const raw of ftsTerms(query)) {
    const term = heldForm(db, raw, params, column)
    if (term === undefined) unheld++
    else if (!forms.has(term)) forms.set(term, { term, count: Number((sql(db, HOLDER_COUNT).get(column ? `${column} : ${term}` : term, ...params) as { n: number }).n) })
  }
  return { terms: [...forms.values()].sort((a, b) => a.count - b.count).slice(0, MAX_TERMS), unheld }
}

/**
 * A query term as the store holds it: a prefix term no visible memory holds is cut, letter by
 * letter, to its longest prefix of at least three letters one holds, so `logların` finds `log` and
 * `saklanma` finds `saklanır`; undefined when none is held. `column` limits the match to one column.
 */
export function heldForm(db: DatabaseSync, term: string, params: SQLInputValue[], column?: string): string | undefined {
  const scoped = (form: string): string => (column ? `${column} : ${form}` : form)
  if (isHeld(db, scoped(term), params)) return term
  // A term with a digit is an identifier, a hash or a number, not a word with a suffix; cutting each
  // took 5.3 s of a 5,000-line paste's search on 3,000 memories, 0.56 s without.
  if (!term.endsWith('*') || /\p{N}/u.test(term)) return undefined
  const bare = term.slice(1, -2)
  for (let end = bare.length - 1; end >= MIN_PREFIX; end--) {
    const cut = `"${bare.slice(0, end)}"*`
    if (isHeld(db, scoped(cut), params)) return cut
  }
  return undefined
}

/**
 * The memories of one store that match a free-text query, best match first: every term first,
 * any term when that finds nothing. The terms are the rarest the store holds, each in its held form
 * (`heldTerms`). A term the store does not hold in any form is no match, so the every-term search
 * cannot succeed and the any-term search runs. A blank query lists the most important memories; a
 * query with no held term finds nothing.
 */
export function searchStore(db: DatabaseSync, query: string, visibility: Visibility, limit: number): Memory[] {
  const params = visibilityParams(visibility)
  if (query.trim() === '') return selectMemories(db, BY_RANK, ...params, limit)
  const held = heldTerms(db, query, params)
  const terms = held.terms.map(item => item.term)
  if (terms.length === 0) return []
  if (held.unheld === 0) {
    const every = selectMemories(db, BY_TEXT, terms.join(' '), ...params, limit)
    if (every.length > 0 || terms.length === 1) return every
  }
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
