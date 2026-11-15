import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Memory } from '../hooks/shared/model.ts'
import { parseMemory, sql } from './rows.ts'
import { visibilityParams, type Visibility } from './search.ts'

/**
 * The vector of each memory's text, one row per memory, tagged with the model that made it and a
 * hash of the text it was made from; and, for a memory of two sentences or more, one vector per
 * sentence under the same hash. A row whose hash no longer matches the memory's text is stale: a
 * search skips it, and the next fill replaces it.
 */

/** A query's vector and the model that made it; only vectors of the same model compare. */
export type SemanticQuery = { modelId: string; vector: Float32Array }

export type VectorHit = { memory: Memory; cosine: number }

/** What one embedding of a memory made: the whole text's vector and one per sentence. */
export type MadeVectors = { id: string; hash: string; vector: Float32Array; sentences: readonly Float32Array[] }

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A sentence ends at `.`, `;`, `!` or `?` before an upper-case letter, a digit, a backquote or a parenthesis. */
const SENTENCE_END = /(?<=[.;!?])\s+(?=[\p{Lu}\d`(])/u

/** A piece shorter than this joins the sentence before it, so "Measured on 2.1.283." is no sentence of its own. */
const MIN_SENTENCE = 40

/**
 * The sentences of a text, each long enough to state a fact; a text of one sentence has none,
 * because its whole vector is that sentence's. Measured on the mpnet model over 194 real
 * memories: a fact reached 0.26 to 0.70 of the whole long memory that states it, and 0.49 to 0.86
 * of that memory's best sentence.
 */
export function sentencesOf(text: string): string[] {
  const pieces: string[] = []
  for (const piece of text.split(SENTENCE_END)) {
    const trimmed = piece.trim()
    if (trimmed === '') continue
    const last = pieces.length - 1
    if (last >= 0 && (trimmed.length < MIN_SENTENCE || (pieces[last] ?? '').length < MIN_SENTENCE)) pieces[last] = `${pieces[last]} ${trimmed}`
    else pieces.push(trimmed)
  }
  return pieces.length > 1 ? pieces : []
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

/** Replaces a memory's sentence vectors with the ones given. */
function writeSentences(db: DatabaseSync, memoryId: string, modelId: string, vectors: readonly Float32Array[], hash: string): void {
  sql(db, 'DELETE FROM sentence_vectors WHERE memory_id = ?').run(memoryId)
  const insert = sql(db, 'INSERT INTO sentence_vectors (memory_id, position, model_id, vector, text_hash) VALUES (?, ?, ?, ?, ?)')
  vectors.forEach((vector, position) => insert.run(memoryId, position, modelId, toBlob(vector), hash))
}

/** Removes every vector of one memory, for a memory that leaves the store. */
export function dropVectors(db: DatabaseSync, memoryId: string): void {
  sql(db, 'DELETE FROM vectors WHERE memory_id = ?').run(memoryId)
  sql(db, 'DELETE FROM sentence_vectors WHERE memory_id = ?').run(memoryId)
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

type SentenceRow = { memory_id: string; vector: Uint8Array; text_hash: string }

/** The sentence vectors of `modelId`, by memory id, each tagged with the hash of the text it was made from. */
function sentenceVectors(db: DatabaseSync, modelId: string): Map<string, Array<{ vector: Float32Array; hash: string }>> {
  const rows = sql(db, 'SELECT memory_id, vector, text_hash FROM sentence_vectors WHERE model_id = ?').all(modelId) as SentenceRow[]
  const byMemory = new Map<string, Array<{ vector: Float32Array; hash: string }>>()
  for (const row of rows) byMemory.set(row.memory_id, [...(byMemory.get(row.memory_id) ?? []), { vector: fromBlob(row.vector), hash: row.text_hash }])
  return byMemory
}

/**
 * The visible memories nearest the query, best cosine first; a stale vector is skipped. With
 * `bySentence`, a memory's cosine is the best of its whole text and each of its sentences, so a
 * fact one sentence of a long memory states is found; search and reminders keep the whole text
 * alone, because their relevance scale was measured on it.
 */
export function vectorHits(db: DatabaseSync, query: SemanticQuery, visibility: Visibility, limit: number, bySentence = false): VectorHit[] {
  const rows = sql(db, VISIBLE).all(query.modelId, ...visibilityParams(visibility)) as VectorRow[]
  const sentences = bySentence ? sentenceVectors(db, query.modelId) : new Map<string, Array<{ vector: Float32Array; hash: string }>>()
  const hits: VectorHit[] = []
  for (const row of rows) {
    const memory = parseMemory(row)
    const vector = fromBlob(row.vector)
    const hash = textHash(memory.text)
    if (vector.length !== query.vector.length || row.text_hash !== hash) continue
    const own = (sentences.get(row.id) ?? []).filter(sentence => sentence.hash === hash && sentence.vector.length === query.vector.length)
    hits.push({ memory, cosine: Math.max(dot(query.vector, vector), ...own.map(sentence => dot(query.vector, sentence.vector))) })
  }
  return hits.sort((a, b) => b.cosine - a.cosine).slice(0, limit)
}

const EMBEDDABLE = `
  SELECT m.id AS id, m.data AS data, v.model_id AS model_id, v.text_hash AS text_hash,
    (SELECT COUNT(*) FROM sentence_vectors s WHERE s.memory_id = m.id AND s.model_id = v.model_id AND s.text_hash = v.text_hash) AS sentence_rows
  FROM memories m LEFT JOIN vectors v ON v.memory_id = m.id
  WHERE m.status IN ('active', 'stale')
  ORDER BY m.updated_at DESC`

type EmbeddableRow = { id: string; data: string; model_id: string | null; text_hash: string | null; sentence_rows: number }

/** Whether a memory a search can reach lacks a vector of `modelId` for its current text, or one of its sentences. */
function needsVector(row: EmbeddableRow, memory: Memory, modelId: string): boolean {
  if (row.model_id !== modelId || row.text_hash !== textHash(memory.text)) return true
  return Number(row.sentence_rows) !== sentencesOf(memory.text).length
}

/** The active and stale memories (the ones a search reaches) that lack a current vector of `modelId`, newest change first. */
export function unembedded(db: DatabaseSync, modelId: string): Memory[] {
  const rows = sql(db, EMBEDDABLE).all() as EmbeddableRow[]
  return rows.map(row => ({ row, memory: parseMemory(row) })).filter(({ row, memory }) => needsVector(row, memory, modelId)).map(({ memory }) => memory)
}

/** Writes each memory's vectors while it still holds the text they were made from; answers how many memories were written. */
export function storeVectors(db: DatabaseSync, modelId: string, made: readonly MadeVectors[]): number {
  let written = 0
  for (const item of made) {
    const row = sql(db, 'SELECT text FROM memories WHERE id = ?').get(item.id) as { text: string } | undefined
    if (row === undefined || textHash(row.text) !== item.hash) continue
    writeVector(db, item.id, modelId, item.vector, item.hash)
    writeSentences(db, item.id, modelId, item.sentences, item.hash)
    written++
  }
  return written
}

/** Removes the vectors of memories the store no longer holds. */
export function dropOrphanVectors(db: DatabaseSync): number {
  const orphans = 'NOT IN (SELECT id FROM memories)'
  sql(db, `DELETE FROM sentence_vectors WHERE memory_id ${orphans}`).run()
  return Number(sql(db, `DELETE FROM vectors WHERE memory_id ${orphans}`).run().changes)
}
