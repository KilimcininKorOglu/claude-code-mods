import type { DatabaseSync } from 'node:sqlite'
import type { ClosePair, Memory } from '../hooks/shared/model.ts'
import { audienceKey, parseMemory, sql } from './rows.ts'
import { dot, fromBlob, sentenceVectors, textHash } from './vectors.ts'

/**
 * The pairs of live memories of one store whose meaning is close: the best cosine between the
 * whole text or any sentence of one and the whole text or any sentence of the other reaches
 * `CLOSE_PAIR_COSINE`. Only memories that share a scope, an audience and an owner pair up, as a
 * write is compared. Triage asks the job model about each pair; no cosine merges alone.
 */

/**
 * The floor of a close pair. It stays above the write's subject floor (`SIMILAR_COSINE`, 0.45),
 * because the daily triage asks about at most 15 pairs, and a paraphrase reached 0.73 to 0.96.
 */
export const CLOSE_PAIR_COSINE = 0.72

type Embedded = { memory: Memory; bucket: string; vectors: Float32Array[] }

const LIVE_VECTORS = `
  SELECT m.id AS id, m.data AS data, v.vector AS vector, v.text_hash AS text_hash FROM vectors v JOIN memories m ON m.id = v.memory_id
  WHERE v.model_id = ? AND m.status IN ('active', 'stale')
  ORDER BY m.id`

type Row = { id: string; data: string; vector: Uint8Array; text_hash: string }

/** The live memories with a current vector of `modelId`, each with its whole and sentence vectors. */
function embedded(db: DatabaseSync, modelId: string): Embedded[] {
  const sentences = sentenceVectors(db, modelId)
  const out: Embedded[] = []
  for (const row of sql(db, LIVE_VECTORS).all(modelId) as Row[]) {
    const memory = parseMemory(row)
    const hash = textHash(memory.text)
    if (row.text_hash !== hash) continue
    const own = (sentences.get(row.id) ?? []).filter(sentence => sentence.hash === hash).map(sentence => sentence.vector)
    out.push({ memory, bucket: `${memory.scope}\0${audienceKey(memory) ?? ''}\0${memory.ownerSessionId ?? ''}`, vectors: [fromBlob(row.vector), ...own] })
  }
  return out
}

function bestCosine(a: Embedded, b: Embedded): number {
  let best = -1
  for (const left of a.vectors) for (const right of b.vectors) best = Math.max(best, dot(left, right))
  return best
}

/**
 * Every close pair of the store, best cosine first. The comparison yields to the event loop after
 * each memory, so requests run between; on 194 memories with 693 sentences it compared 18,721
 * pairs.
 */
export async function closePairs(db: DatabaseSync, modelId: string): Promise<ClosePair[]> {
  const items = embedded(db, modelId)
  const pairs: ClosePair[] = []
  for (const [index, a] of items.entries()) {
    for (const b of items.slice(index + 1)) {
      if (a.bucket !== b.bucket) continue
      const cosine = bestCosine(a, b)
      if (cosine >= CLOSE_PAIR_COSINE) pairs.push({ a: a.memory.id, b: b.memory.id, cosine: Math.round(cosine * 100) / 100 })
    }
    await new Promise(resolve => setImmediate(resolve))
  }
  return pairs.sort((x, y) => y.cosine - x.cosine)
}
