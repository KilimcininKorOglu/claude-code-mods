import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Memory } from '../hooks/shared/model.ts'
import { parseMemory, sql } from './rows.ts'
import { visibilityParams, type Visibility } from './search.ts'

/**
 * The vector of each memory's text, one row per memory, tagged with the model that made it and a
 * hash of the text it was made from. A row whose hash no longer matches the memory's text is
 * stale: a search skips it, and the next fill replaces it.
 */

/** A query's vector and the model that made it; only vectors of the same model compare. */
export type SemanticQuery = { modelId: string; vector: Float32Array }

export type VectorHit = { memory: Memory; cosine: number }

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

/** A stored vector, copied so its bytes start on a 4-byte boundary. */
function fromBlob(blob: Uint8Array): Float32Array {
  const bytes = new Uint8Array(blob)
  return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4)
}

export function writeVector(db: DatabaseSync, memoryId: string, modelId: string, vector: Float32Array, hash: string): void {
  sql(db, 'INSERT OR REPLACE INTO vectors (memory_id, model_id, dims, vector, text_hash) VALUES (?, ?, ?, ?, ?)').run(memoryId, modelId, vector.length, toBlob(vector), hash)
}

/** The vectors are normalized, so their dot product is their cosine. */
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
  return sum
}

const VISIBLE = `
  SELECT m.id AS id, m.data AS data, v.vector AS vector, v.text_hash AS text_hash FROM vectors v JOIN memories m ON m.id = v.memory_id
  WHERE v.model_id = ?
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)`

type VectorRow = { id: string; data: string; vector: Uint8Array; text_hash: string }

/** The visible memories nearest the query, best cosine first; a stale vector is skipped. */
export function vectorHits(db: DatabaseSync, query: SemanticQuery, visibility: Visibility, limit: number): VectorHit[] {
  const rows = sql(db, VISIBLE).all(query.modelId, ...visibilityParams(visibility)) as VectorRow[]
  const hits: VectorHit[] = []
  for (const row of rows) {
    const memory = parseMemory(row)
    const vector = fromBlob(row.vector)
    if (vector.length === query.vector.length && row.text_hash === textHash(memory.text)) hits.push({ memory, cosine: dot(query.vector, vector) })
  }
  return hits.sort((a, b) => b.cosine - a.cosine).slice(0, limit)
}

const EMBEDDABLE = `
  SELECT m.id AS id, m.data AS data, v.model_id AS model_id, v.text_hash AS text_hash FROM memories m LEFT JOIN vectors v ON v.memory_id = m.id
  WHERE m.status IN ('active', 'stale')
  ORDER BY m.updated_at DESC`

type EmbeddableRow = { id: string; data: string; model_id: string | null; text_hash: string | null }

/** Whether a memory a search can reach has no vector of `modelId` for its current text. */
function needsVector(row: EmbeddableRow, memory: Memory, modelId: string): boolean {
  return row.model_id !== modelId || row.text_hash !== textHash(memory.text)
}

/** The active and stale memories (the ones a search reaches) that lack a current vector of `modelId`, newest change first. */
export function unembedded(db: DatabaseSync, modelId: string): Memory[] {
  const rows = sql(db, EMBEDDABLE).all() as EmbeddableRow[]
  return rows.map(row => ({ row, memory: parseMemory(row) })).filter(({ row, memory }) => needsVector(row, memory, modelId)).map(({ memory }) => memory)
}

/** Writes each vector while its memory still holds the text it was made from; answers how many were written. */
export function storeVectors(db: DatabaseSync, modelId: string, made: ReadonlyArray<{ id: string; hash: string; vector: Float32Array }>): number {
  let written = 0
  for (const item of made) {
    const row = sql(db, 'SELECT text FROM memories WHERE id = ?').get(item.id) as { text: string } | undefined
    if (row === undefined || textHash(row.text) !== item.hash) continue
    writeVector(db, item.id, modelId, item.vector, item.hash)
    written++
  }
  return written
}

/** Removes the vectors of memories the store no longer holds. */
export function dropOrphanVectors(db: DatabaseSync): number {
  return Number(sql(db, 'DELETE FROM vectors WHERE memory_id NOT IN (SELECT id FROM memories)').run().changes)
}
