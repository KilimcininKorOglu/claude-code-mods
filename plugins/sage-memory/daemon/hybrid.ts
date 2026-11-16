import type { DatabaseSync } from 'node:sqlite'
import type { SearchHit } from '../hooks/shared/model.ts'
import { fuse, lexicalHits } from './fusion.ts'
import { interleave, searchStore, type Visibility } from './search.ts'
import { vectorHits, type SemanticQuery } from './vectors.ts'

/**
 * A search over the project's store and the user store: the text index of each, merged rank by
 * rank, and, while embeddings are on, the vector hits of both fused in by reciprocal rank. A blank
 * query lists the most important memories and asks the vector channel nothing. Every memory with a
 * current vector takes part, because `vectorHits` scores all of them anyway: a cut at the best 50
 * left a text hit outside it without its cosine, so `vectorScore` null read as no meaning at all.
 * Null now means the memory has no current vector.
 */
export function searchHybrid(dbs: readonly [DatabaseSync, DatabaseSync], query: string, visibility: Visibility, limit: number, semantic: SemanticQuery | undefined): SearchHit[] {
  const [project, user] = dbs
  const lexical = interleave(searchStore(project, query, visibility, limit), searchStore(user, query, visibility, limit))
  if (semantic === undefined || query.trim() === '') return lexicalHits(lexical.slice(0, limit))
  const every = Number.POSITIVE_INFINITY
  const vectors = [...vectorHits(project, semantic, visibility, every, true), ...vectorHits(user, semantic, visibility, every, true)].sort((a, b) => b.cosine - a.cosine)
  return fuse(lexical, vectors, limit)
}
