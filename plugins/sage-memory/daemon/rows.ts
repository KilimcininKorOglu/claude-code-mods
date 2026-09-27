import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'
import type { AuditEntry, Candidate, Memory } from '../hooks/shared/model.ts'
import { canonicalText } from '../hooks/shared/text.ts'
import { messageOf } from './log.ts'
import type { Store } from './stores.ts'

/** Reading and writing rows: prepared statements, the memory and candidate records, the audit log. */

const statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>()

/** The prepared statement for `text` on `db`, prepared once per connection. */
export function sql(db: DatabaseSync, text: string): StatementSync {
  let cache = statements.get(db)
  if (!cache) {
    cache = new Map()
    statements.set(db, cache)
  }
  let statement = cache.get(text)
  if (!statement) {
    statement = db.prepare(text)
    cache.set(text, statement)
  }
  return statement
}

type DataRow = { id: string; data: string }

const REQUIRED: ReadonlyArray<[keyof Memory, string]> = [
  ['id', 'string'],
  ['text', 'string'],
  ['scope', 'string'],
  ['kind', 'string'],
  ['status', 'string'],
  ['importance', 'number'],
  ['confidence', 'number'],
  ['freshness', 'number'],
  ['createdAt', 'string'],
  ['updatedAt', 'string'],
]

/** A stored record; a row that is not one is an error that names the row. */
function parse<T>(row: DataRow, what: string): T {
  try {
    return JSON.parse(row.data) as T
  } catch (err) {
    throw new Error(`the stored ${what} ${row.id} is not JSON: ${messageOf(err)}`)
  }
}

export function parseMemory(row: DataRow): Memory {
  const memory = parse<Memory>(row, 'memory')
  const missing = REQUIRED.find(([field, type]) => typeof memory[field] !== type)
  if (missing) throw new Error(`the stored memory ${row.id} has no ${missing[1]} ${missing[0]}`)
  return memory
}

export function readMemory(db: DatabaseSync, id: string): Memory | undefined {
  const row = sql(db, 'SELECT id, data FROM memories WHERE id = ?').get(id) as DataRow | undefined
  return row ? parseMemory(row) : undefined
}

/** The memories a complete `SELECT id, data FROM memories ...` query answers, in its order. */
export function selectMemories(db: DatabaseSync, query: string, ...params: SQLInputValue[]): Memory[] {
  const rows = sql(db, query).all(...params) as DataRow[]
  return rows.map(parseMemory)
}

/** The `id` column of every row a complete `SELECT ... AS id ...` query answers, in its order. */
export function selectIds(db: DatabaseSync, query: string, ...params: SQLInputValue[]): string[] {
  return (sql(db, query).all(...params) as Array<{ id: string }>).map(row => row.id)
}

/** The stored form of an audience, compared with `IS` so no audience matches no audience. */
export function audienceKey(memory: Pick<Memory, 'audience'>): string | null {
  return memory.audience ? JSON.stringify(memory.audience) : null
}

const UPSERT = `
  INSERT INTO memories (id, data, text, status, kind, scope, persistence, context_policy, importance, confidence, freshness,
    audience, tags, owner_session_id, canonical_text, created_at, updated_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    data = excluded.data, text = excluded.text, status = excluded.status, kind = excluded.kind, scope = excluded.scope,
    persistence = excluded.persistence, context_policy = excluded.context_policy, importance = excluded.importance,
    confidence = excluded.confidence, freshness = excluded.freshness, audience = excluded.audience, tags = excluded.tags,
    owner_session_id = excluded.owner_session_id, canonical_text = excluded.canonical_text, created_at = excluded.created_at,
    updated_at = excluded.updated_at, expires_at = excluded.expires_at`

/** Writes the whole record and its column copies. */
export function writeMemory(db: DatabaseSync, memory: Memory): void {
  sql(db, UPSERT).run(
    memory.id,
    JSON.stringify(memory),
    memory.text,
    memory.status,
    memory.kind,
    memory.scope,
    memory.persistence,
    memory.contextPolicy,
    memory.importance,
    memory.confidence,
    memory.freshness,
    audienceKey(memory),
    JSON.stringify(memory.tags),
    memory.ownerSessionId ?? null,
    canonicalText(memory.text),
    memory.createdAt,
    memory.updatedAt,
    memory.expiresAt ?? null,
  )
}

export function readCandidate(db: DatabaseSync, id: string): Candidate | undefined {
  const row = sql(db, 'SELECT id, data FROM candidates WHERE id = ?').get(id) as DataRow | undefined
  return row ? parse<Candidate>(row, 'candidate') : undefined
}

/** The candidates a complete `SELECT id, data FROM candidates ...` query answers, in its order. */
export function selectCandidates(db: DatabaseSync, query: string, ...params: SQLInputValue[]): Candidate[] {
  const rows = sql(db, query).all(...params) as DataRow[]
  return rows.map(row => parse<Candidate>(row, 'candidate'))
}

export function writeCandidate(db: DatabaseSync, candidate: Candidate): void {
  sql(
    db,
    `INSERT OR REPLACE INTO candidates (id, data, status, target_memory_id, canonical_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    candidate.id,
    JSON.stringify(candidate),
    candidate.status,
    candidate.targetMemoryId ?? null,
    canonicalText(candidate.text),
    candidate.createdAt,
    candidate.updatedAt,
  )
}

/** The audit log keeps its last 1000 rows, cut every 256 writes so no write pays for a delete. */
const AUDIT_KEEP = 1000
const AUDIT_CUT_EVERY = 256

export type AuditFields = { memoryId?: string; sessionId?: string; detail?: unknown }

export function audit(store: Store, at: string, action: string, fields: AuditFields = {}): void {
  const detail = fields.detail === undefined ? null : JSON.stringify(fields.detail)
  sql(store.db, 'INSERT INTO audit_log (at, action, memory_id, session_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    at,
    action,
    fields.memoryId ?? null,
    fields.sessionId ?? null,
    detail,
  )
  store.auditWrites++
  if (store.auditWrites < AUDIT_CUT_EVERY) return
  store.auditWrites = 0
  sql(store.db, 'DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)').run(AUDIT_KEEP)
}

type AuditRow = { at: string; action: string; memory_id: string | null; session_id: string | null; detail: string | null }

/** The newest `limit` audit rows, newest first. */
export function readAudit(db: DatabaseSync, limit: number): AuditEntry[] {
  const rows = sql(db, 'SELECT at, action, memory_id, session_id, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as AuditRow[]
  return rows.map(row => {
    const entry: AuditEntry = { at: row.at, action: row.action }
    if (row.memory_id !== null) entry.memoryId = row.memory_id
    if (row.session_id !== null) entry.sessionId = row.session_id
    if (row.detail !== null) entry.detail = JSON.parse(row.detail) as unknown
    return entry
  })
}
