import type { DatabaseSync } from 'node:sqlite'
import { STATUSES, type Kind, type Memory, type MemoryPage, type Scope, type Status, type StoreStats } from '../hooks/shared/model.ts'
import { refused } from './errors.ts'
import { descending } from './order.ts'
import { selectMemories, sql } from './rows.ts'

/**
 * Listing a store page by page, newest change first, and counting what it holds. A page may read
 * both stores at once: each store answers the rows after the cursor, and the two are merged.
 */

export type ListOptions = {
  statuses: readonly Status[]
  kind?: Kind
  /** A piece of the text, compared case-insensitively. */
  query?: string
  scope?: Scope
  limit: number
  cursor?: string
  sessionId?: string
  allSessions?: boolean
}

/** Where the previous page ended, as the listing orders its rows. */
type Cursor = { updatedAt: string; id: string }

export function encodeCursor(memory: Memory): string {
  return Buffer.from(JSON.stringify({ u: memory.updatedAt, i: memory.id }), 'utf8').toString('base64url')
}

/** Refuses a cursor this daemon did not write, so a client never pages from the start again unnoticed. */
export function decodeCursor(cursor: string): Cursor {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw refused('the cursor is not one a listing wrote')
  }
  const { u, i } = (value ?? {}) as { u?: unknown; i?: unknown }
  if (typeof u !== 'string' || typeof i !== 'string') throw refused('the cursor is not one a listing wrote')
  return { updatedAt: u, id: i }
}

const PAGE = `
  SELECT m.id AS id, m.data AS data FROM memories m
  WHERE m.status IN (SELECT value FROM json_each(?)) AND (? IS NULL OR m.kind = ?) AND (? IS NULL OR m.scope = ?)
    AND (? IS NULL OR instr(unicode_lower(m.text), ?) > 0) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?)
    AND (? IS NULL OR m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))
  ORDER BY m.updated_at DESC, m.id DESC
  LIMIT ?`

const COUNT = `
  SELECT COUNT(*) AS n FROM memories m
  WHERE m.status IN (SELECT value FROM json_each(?)) AND (? IS NULL OR m.kind = ?) AND (? IS NULL OR m.scope = ?)
    AND (? IS NULL OR instr(unicode_lower(m.text), ?) > 0) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?)`

const STATUS_COUNTS = `
  SELECT m.status AS status, COUNT(*) AS n FROM memories m
  WHERE (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?)
  GROUP BY m.status`

/** The filter parameters `PAGE` and `COUNT` share, in their order. */
function filterParams(options: ListOptions): Array<string | number | null> {
  const kind = options.kind ?? null
  const scope = options.scope ?? null
  const query = options.query?.trim() ? options.query.trim().normalize('NFKC').toLowerCase() : null
  return [JSON.stringify(options.statuses), kind, kind, scope, scope, query, query, options.allSessions === true ? 1 : 0, options.sessionId ?? null]
}

function cursorParams(cursor: Cursor | undefined): Array<string | null> {
  return cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.updatedAt, cursor.id] : [null, null, null, null]
}

/** Newest change first, the id breaking a tie: the order the cursor follows. */
function newestFirst(left: Memory, right: Memory): number {
  return descending(left.updatedAt, right.updatedAt) || descending(left.id, right.id)
}

function addCounts(into: Record<string, number>, db: DatabaseSync, options: ListOptions): void {
  const rows = sql(db, STATUS_COUNTS).all(options.allSessions === true ? 1 : 0, options.sessionId ?? null) as Array<{ status: string; n: number }>
  for (const row of rows) into[row.status] = (into[row.status] ?? 0) + row.n
}

/** One page over the stores given, their rows merged in the listing's order. */
export function listPage(dbs: readonly DatabaseSync[], options: ListOptions): MemoryPage {
  const filter = filterParams(options)
  const after = cursorParams(options.cursor === undefined ? undefined : decodeCursor(options.cursor))
  const rows = dbs.flatMap(db => selectMemories(db, PAGE, ...filter, ...after, options.limit + 1)).sort(newestFirst)
  const memories = rows.slice(0, options.limit)
  const last = memories.at(-1)
  const statusCounts: Record<string, number> = {}
  let total = 0
  for (const db of dbs) {
    total += (sql(db, COUNT).get(...filter) as { n: number }).n
    addCounts(statusCounts, db, options)
  }
  return { memories, nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null, total, statusCounts }
}

/** What one store holds: memories by status (every status, zero when none) and by kind, and its edges. */
export function storeStats(db: DatabaseSync): StoreStats {
  const statusRows = sql(db, 'SELECT status, COUNT(*) AS n FROM memories GROUP BY status').all() as Array<{ status: string; n: number }>
  const kindRows = sql(db, 'SELECT kind, COUNT(*) AS n FROM memories GROUP BY kind').all() as Array<{ kind: string; n: number }>
  const byStatus = Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<Status, number>
  for (const row of statusRows) byStatus[row.status as Status] = row.n
  return {
    total: statusRows.reduce((sum, row) => sum + row.n, 0),
    byStatus,
    byKind: Object.fromEntries(kindRows.map(row => [row.kind, row.n])),
    edges: (sql(db, 'SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n,
  }
}
