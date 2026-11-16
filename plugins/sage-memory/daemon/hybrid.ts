import type { DatabaseSync } from 'node:sqlite'
import type { SearchHit } from '../hooks/shared/model.ts'
import { fuse, lexicalHits } from './fusion.ts'
import { interleave, searchStore, type Visibility } from './search.ts'
import { vectorHits, type SemanticQuery } from './vectors.ts'

/**
 * A search over the project's store, the user store and the project stores above or below the
 * project (`dbs`, the project's first): the text index of each, merged rank by rank, and, while
 * embeddings are on, the vector hits of all of them fused in by reciprocal rank. A blank
 * query lists the most important memories and asks the vector channel nothing. Every memory with a
 * current vector takes part, because `vectorHits` scores all of them anyway: a cut at the best 50
 * left a text hit outside it without its cosine, so `vectorScore` null read as no meaning at all.
 * Null now means the memory has no current vector.
 */
export function searchHybrid(dbs: readonly DatabaseSync[], query: string, visibility: Visibility, limit: number, semantic: SemanticQuery | undefined, floor: number): SearchHit[] {
  return searchWithCosines(dbs, query, visibility, limit, semantic, floor).hits
}

/** The search's hits, and the cosine of every memory with a current vector, also the ones the hits leave out. */
export type ScoredSearch = { hits: SearchHit[]; cosines: ReadonlyMap<string, number> }

export function searchWithCosines(dbs: readonly DatabaseSync[], query: string, visibility: Visibility, limit: number, semantic: SemanticQuery | undefined, floor: number): ScoredSearch {
  const lexical = interleave(...dbs.map(db => searchStore(db, query, visibility, limit)))
  if (semantic === undefined || query.trim() === '') return { hits: lexicalHits(lexical.slice(0, limit)), cosines: new Map() }
  const every = Number.POSITIVE_INFINITY
  const vectors = dbs.flatMap(db => vectorHits(db, semantic, visibility, every, true)).sort((a, b) => b.cosine - a.cosine)
  return { hits: fuse(lexical, vectors, limit, floor), cosines: new Map(vectors.map(hit => [hit.memory.id, hit.cosine])) }
}
