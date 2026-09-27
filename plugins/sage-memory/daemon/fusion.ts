import type { Memory, SearchHit } from '../hooks/shared/model.ts'
import { SEMANTIC_FLOOR_COSINE } from './relevance.ts'
import type { VectorHit } from './vectors.ts'

/**
 * Reciprocal-rank fusion of the text index and the vector channel, ported from SAGE's
 * `augmentLexicalWithVectorRecall`: a memory gains weight / (K + rank) from each list it is in,
 * the vector list weighing 0.3. A vector hit the text index also found lifts that memory; one it
 * missed enters only from the cosine a reminder could still use.
 */

const VECTOR_WEIGHT = 0.3
const RRF_K = 60
/** At most this many memories enter from the vector channel alone. */
const MAX_VECTOR_ONLY = 12

function rankScore(index: number, total: number): number {
  return total <= 1 ? 1 : 1 - index / (total - 1)
}

/** A text-index list as search hits, each scored by its place. */
export function lexicalHits(lexical: readonly Memory[]): SearchHit[] {
  return lexical.map((memory, index) => {
    const lexicalScore = rankScore(index, lexical.length)
    return { memory, lexicalScore, vectorScore: null, finalScore: lexicalScore, source: 'lexical' }
  })
}

/** The vector hits that take a rank: each one the text index found, and the best vector-only ones from the floor up. */
function fusable(lexicalIds: ReadonlySet<string>, vectors: readonly VectorHit[]): VectorHit[] {
  const kept: VectorHit[] = []
  let alone = 0
  for (const hit of vectors) {
    if (lexicalIds.has(hit.memory.id)) {
      kept.push(hit)
    } else if (hit.cosine >= SEMANTIC_FLOOR_COSINE && alone < MAX_VECTOR_ONLY) {
      alone++
      kept.push(hit)
    }
  }
  return kept
}

/** Both lists as one, best fused score first; `vectors` comes best cosine first, each memory once. */
export function fuse(lexical: readonly Memory[], vectors: readonly VectorHit[], limit: number): SearchHit[] {
  const fused = new Map<string, SearchHit>()
  lexical.forEach((memory, index) => {
    fused.set(memory.id, { memory, lexicalScore: rankScore(index, lexical.length), vectorScore: null, finalScore: (1 - VECTOR_WEIGHT) / (RRF_K + index + 1), source: 'lexical' })
  })
  fusable(new Set(fused.keys()), vectors).forEach((hit, rank) => {
    const share = VECTOR_WEIGHT / (RRF_K + rank + 1)
    const known = fused.get(hit.memory.id)
    const next: SearchHit = known
      ? { ...known, vectorScore: hit.cosine, finalScore: known.finalScore + share, source: 'both' }
      : { memory: hit.memory, lexicalScore: null, vectorScore: hit.cosine, finalScore: share, source: 'vector' }
    fused.set(hit.memory.id, next)
  })
  return [...fused.values()].sort((a, b) => b.finalScore - a.finalScore).slice(0, limit)
}
