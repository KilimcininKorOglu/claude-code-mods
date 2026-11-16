import type { Memory, SearchHit } from '../hooks/shared/model.ts'
import type { VectorHit } from './vectors.ts'

/**
 * Reciprocal-rank fusion of the text index and the vector channel: a memory gains weight / (K + rank)
 * from each list it is in, both lists weighing alike. A vector hit the text index also found lifts that
 * memory; one it missed enters only above the noise floor the caller gives. SAGE weighed the vector
 * list 0.3, so a memory only the vector found ranked behind the first 82 text hits and never entered a
 * list the text index filled: none did in 57 measured prompts, whose word search, with an OR fallback,
 * matched more memories than the 48 places.
 */

const VECTOR_WEIGHT = 0.5
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

/**
 * The vector hits that take a rank: each one above the floor the text index found, and the best
 * vector-only ones above it. A cosine at or under the floor says the text shares no topic with the
 * query, so it lifts no memory: when every text match took a vector share, the word search of one
 * English question matched 50 of 300 memories with cosines down to 0.1, and those outranked the one
 * memory at 0.72 the words missed, in the prompt's list and in the search tool's.
 */
function fusable(lexicalIds: ReadonlySet<string>, vectors: readonly VectorHit[], floor: number): VectorHit[] {
  const kept: VectorHit[] = []
  let alone = 0
  for (const hit of vectors) {
    if (hit.cosine <= floor) continue
    if (lexicalIds.has(hit.memory.id)) {
      kept.push(hit)
    } else if (alone < MAX_VECTOR_ONLY) {
      alone++
      kept.push(hit)
    }
  }
  return kept
}

/**
 * Both lists as one, best fused score first; `vectors` comes best cosine first, each memory once. A
 * memory only the vector channel finds enters above `floor`, the cosine at or under which a text shares
 * no topic with the query (the noise band).
 */
export function fuse(lexical: readonly Memory[], vectors: readonly VectorHit[], limit: number, floor: number): SearchHit[] {
  const fused = new Map<string, SearchHit>()
  lexical.forEach((memory, index) => {
    fused.set(memory.id, { memory, lexicalScore: rankScore(index, lexical.length), vectorScore: null, finalScore: (1 - VECTOR_WEIGHT) / (RRF_K + index + 1), source: 'lexical' })
  })
  fusable(new Set(fused.keys()), vectors, floor).forEach((hit, rank) => {
    const share = VECTOR_WEIGHT / (RRF_K + rank + 1)
    const known = fused.get(hit.memory.id)
    const next: SearchHit = known
      ? { ...known, vectorScore: hit.cosine, finalScore: known.finalScore + share, source: 'both' }
      : { memory: hit.memory, lexicalScore: null, vectorScore: hit.cosine, finalScore: share, source: 'vector' }
    fused.set(hit.memory.id, next)
  })
  // A text match under the floor keeps its cosine, which the relevance rules read, and gains no rank from it.
  for (const hit of vectors) {
    const known = fused.get(hit.memory.id)
    if (known !== undefined && known.vectorScore === null) fused.set(hit.memory.id, { ...known, vectorScore: hit.cosine })
  }
  return [...fused.values()].sort((a, b) => b.finalScore - a.finalScore).slice(0, limit)
}
