import type { DatabaseSync } from 'node:sqlite'
import type { SearchHit } from '../hooks/shared/model.ts'
import { fuse, lexicalHits } from './fusion.ts'
import { interleave, searchStore, type Visibility } from './search.ts'
import { vectorHits, type SemanticQuery } from './vectors.ts'

/** SAGE fetches at least this many vector hits, so a small limit still sees the vector channel's best. */
const VECTOR_FETCH = 50

/**
 * A search over the project's store and the user store: the text index of each, merged rank by
 * rank, and, while embeddings are on, the vector hits of both fused in by reciprocal rank. A blank
 * query lists the most important memories and asks the vector channel nothing.
 */
export function searchHybrid(dbs: readonly [DatabaseSync, DatabaseSync], query: string, visibility: Visibility, limit: number, semantic: SemanticQuery | undefined): SearchHit[] {
  const [project, user] = dbs
  const lexical = interleave(searchStore(project, query, visibility, limit), searchStore(user, query, visibility, limit))
  if (semantic === undefined || query.trim() === '') return lexicalHits(lexical.slice(0, limit))
  const fetch = Math.max(limit * 2, VECTOR_FETCH)
  const vectors = [...vectorHits(project, semantic, visibility, fetch), ...vectorHits(user, semantic, visibility, fetch)].sort((a, b) => b.cosine - a.cosine)
  return fuse(lexical, vectors, limit)
}
