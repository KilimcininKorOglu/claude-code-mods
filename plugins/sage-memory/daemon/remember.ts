import type { Anchor, Audience, ContextPolicy, Kind, Memory, Persistence, RememberInput, RememberResult, Scope, SimilarMemory, Source, Status } from '../hooks/shared/model.ts'
import { canonicalText, normalizeTags } from '../hooks/shared/text.ts'
import { distinct, normalizeAnchors, normalizeSources } from './anchors.ts'
import { refused } from './errors.ts'
import { ftsTerms, MAX_TERMS } from './fts.ts'
import { syncEdges } from './graph.ts'
import { storeLabel, type Op } from './op.ts'
import { assessQuality, checkRemember, clamp01, isNearDuplicate, normalizeAudience, rejectSecrets, takesEndDate } from './rules.ts'
import { MEANING_FLOOR_COSINE } from './relevance.ts'
import { audienceKey, readMemory, selectMemories, writeMemory } from './rows.ts'
import { EVERY_POLICY } from './search.ts'
import { ulid } from './ulid.ts'
import { vectorHits, type SemanticQuery } from './vectors.ts'

/**
 * Writing a memory: a new record, or a merge into the live memory of the same scope and audience
 * that says the same thing (the same canonical text, or the same kind in other words). Ported
 * from SAGE's `rememberSage`, with one change: the memories the new one `supersedes` become
 * superseded by it.
 */

const DEFAULT_IMPORTANCE = 0.6
const DEFAULT_CONFIDENCE = 0.8

/**
 * The cosine from which a live memory is on the same subject as a new write, so the writer judges
 * whether the write adds anything to it (see `similarOf`). It is the meaning floor of the reminders:
 * a cosine cannot tell a restated rule from a new one (a rule and a case of it measured 0.67, and two
 * opposite preferences 0.96), so it only picks the memories the job model reads.
 */
export const SIMILAR_COSINE = MEANING_FLOOR_COSINE
/** How many related memories an answer names. */
const MAX_SIMILAR = 5
const LIVE: readonly Status[] = ['active', 'stale']

type Draft = {
  text: string
  scope: Scope
  kind: Kind
  tags: string[]
  anchors: Anchor[]
  audience: Audience | undefined
  sources: Source[]
  importance: number
  confidence: number
  freshness: number
  persistence: Persistence | undefined
  contextPolicy: ContextPolicy | undefined
  supersedes: string[]
  contradicts: string[]
  related: string[]
  ownerSessionId: string | undefined
  expiresAt: string | undefined
}

function ids(list: readonly string[] | undefined): string[] {
  return [...new Set((list ?? []).map(id => id.trim()))]
}

function scores(input: RememberInput, draft: Pick<Draft, 'text' | 'kind' | 'anchors' | 'tags' | 'scope'>): Pick<Draft, 'importance' | 'confidence' | 'freshness'> {
  const caps = assessQuality(draft)
  return {
    importance: input.importance !== undefined ? clamp01(input.importance) : Math.min(DEFAULT_IMPORTANCE, caps.importance),
    confidence: input.confidence !== undefined ? clamp01(input.confidence) : Math.min(DEFAULT_CONFIDENCE, caps.confidence),
    freshness: clamp01(input.freshness ?? 1),
  }
}

function draftOf(op: Op, input: RememberInput, text: string): Draft {
  const scope = input.scope ?? 'project'
  const base = {
    text,
    scope,
    kind: input.kind ?? 'fact',
    tags: normalizeTags(input.tags),
    anchors: normalizeAnchors(op.root, scope, input.anchors ?? []),
  }
  return {
    ...base,
    ...scores(input, base),
    audience: normalizeAudience(input.audience),
    sources: normalizeSources(input.sources ?? [{ type: 'user' }]),
    persistence: input.persistence,
    contextPolicy: input.contextPolicy,
    supersedes: ids(input.supersedes),
    contradicts: ids(input.contradicts),
    related: ids(input.related),
    ownerSessionId: scope === 'session' ? input.ownerSessionId : undefined,
    expiresAt: input.expiresAt,
  }
}

/** Every id a relationship names is a live memory of this store. */
export function checkRelations(op: Op, lists: { supersedes?: readonly string[]; contradicts?: readonly string[]; related?: readonly string[] }): void {
  const named = [
    ['supersedes', lists.supersedes ?? []],
    ['contradicts', lists.contradicts ?? []],
    ['related', lists.related ?? []],
  ] as const
  for (const [name, list] of named) {
    for (const id of list) {
      const target = readMemory(op.store.db, id)
      if (!target || target.status === 'deleted') throw refused(`${name} names ${id}, which is not a live memory in the ${storeLabel(op.store)} store`)
    }
  }
}

const EXACT = `
  SELECT id, data FROM memories
  WHERE status IN ('active', 'stale') AND scope = ? AND canonical_text = ? AND audience IS ? AND (? IS NULL OR owner_session_id = ?)
  LIMIT 1`

const BY_IMPORTANCE = `
  SELECT id, data FROM memories
  WHERE status IN ('active', 'stale') AND scope = ? AND audience IS ? AND (? IS NULL OR owner_session_id = ?)
  ORDER BY importance DESC, updated_at DESC LIMIT 64`

const BY_TEXT = `
  SELECT m.id AS id, m.data AS data FROM memories_fts f CROSS JOIN memories m ON m.rowid = f.rowid
  WHERE memories_fts MATCH ? AND m.status IN ('active', 'stale') AND m.scope = ? AND m.audience IS ?
    AND (? IS NULL OR m.owner_session_id = ?)
  ORDER BY bm25(memories_fts) LIMIT 32`

function exactMatch(op: Op, draft: Draft): Memory | undefined {
  const owner = draft.ownerSessionId ?? null
  return selectMemories(op.store.db, EXACT, draft.scope, canonicalText(draft.text), audienceKey(draft), owner, owner)[0]
}

/**
 * The near-duplicates by words among the scope's 64 most important memories and the 32 the text
 * search ranks closest, weightiest first. They are answered, never merged: the same words can state
 * the opposite fact ("tabs over spaces" and "spaces over tabs" overlap whole), and a pair that cannot
 * both hold is one the writer most needs to see.
 */
function wordSimilar(op: Op, draft: Draft): Memory[] {
  const owner = draft.ownerSessionId ?? null
  const audience = audienceKey(draft)
  const pool = new Map(selectMemories(op.store.db, BY_IMPORTANCE, draft.scope, audience, owner, owner).map(memory => [memory.id, memory]))
  const terms = ftsTerms(draft.text).slice(0, MAX_TERMS)
  if (terms.length > 0) {
    for (const memory of selectMemories(op.store.db, BY_TEXT, terms.join(' OR '), draft.scope, audience, owner, owner)) pool.set(memory.id, memory)
  }
  const weight = (memory: Memory): number => memory.importance * 2 + memory.confidence + memory.freshness
  return [...pool.values()].filter(memory => !draft.supersedes.includes(memory.id) && isNearDuplicate(draft, memory)).sort((a, b) => weight(b) - weight(a))
}

function without(list: readonly string[], id: string): string[] | undefined {
  const kept = list.filter(value => value !== id)
  return kept.length > 0 ? kept : undefined
}

function mergedPersistence(existing: Persistence, incoming: Persistence | undefined): Persistence {
  if (incoming === undefined || existing === 'permanent') return existing
  return incoming
}

/** The lists of both writes joined, and no memory naming itself. */
function mergedLists(existing: Memory, draft: Draft): Pick<Memory, 'tags' | 'anchors' | 'sources' | 'supersedes' | 'contradicts' | 'related'> {
  return {
    tags: [...new Set([...existing.tags, ...draft.tags])],
    anchors: distinct([...existing.anchors, ...draft.anchors]),
    sources: distinct([...existing.sources, ...draft.sources]),
    supersedes: without([...new Set([...(existing.supersedes ?? []), ...draft.supersedes])], existing.id),
    contradicts: without([...new Set([...(existing.contradicts ?? []), ...draft.contradicts])], existing.id),
    related: without([...new Set([...(existing.related ?? []), ...draft.related])], existing.id),
  }
}

/**
 * The existing memory with the same text folded in: unions of lists, the larger scores, its own
 * kind, wording and history.
 */
function merged(op: Op, existing: Memory, draft: Draft): Memory {
  const reactivated = existing.status === 'stale'
  const persistence = mergedPersistence(existing.persistence, draft.persistence)
  // A durable memory that took a state's write keeps no end date, so it is never deleted with the state.
  const expiresAt = takesEndDate({ scope: existing.scope, persistence }) ? (draft.expiresAt ?? existing.expiresAt) : undefined
  return {
    ...existing,
    ...mergedLists(existing, draft),
    status: reactivated ? 'active' : existing.status,
    staleReason: reactivated ? undefined : existing.staleReason,
    audience: draft.audience ?? existing.audience,
    importance: Math.max(existing.importance, draft.importance),
    confidence: Math.max(existing.confidence, draft.confidence),
    freshness: Math.max(existing.freshness, draft.freshness),
    persistence,
    contextPolicy: draft.contextPolicy ?? existing.contextPolicy,
    expiresAt,
    revision: existing.revision + 1,
    updatedAt: op.now,
  }
}

function added(op: Op, draft: Draft): Memory {
  return {
    id: ulid(),
    revision: 1,
    scope: draft.scope,
    kind: draft.kind,
    status: 'active',
    contextPolicy: draft.contextPolicy ?? 'auto',
    persistence: draft.persistence ?? 'long_lived',
    text: draft.text,
    importance: draft.importance,
    confidence: draft.confidence,
    freshness: draft.freshness,
    tags: draft.tags,
    anchors: draft.anchors,
    audience: draft.audience,
    sources: draft.sources,
    supersedes: draft.supersedes.length > 0 ? draft.supersedes : undefined,
    contradicts: draft.contradicts.length > 0 ? draft.contradicts : undefined,
    related: draft.related.length > 0 ? draft.related : undefined,
    createdAt: op.now,
    updatedAt: op.now,
    ownerSessionId: draft.ownerSessionId,
    expiresAt: draft.expiresAt,
  }
}

/** Moves the live memories `memory` replaces to `superseded`, pointing at it; answers their ids. */
export function supersede(op: Op, memory: Memory, targets: readonly string[]): string[] {
  const moved: string[] = []
  for (const id of targets) {
    const target = id === memory.id ? undefined : readMemory(op.store.db, id)
    if (!target || (target.status !== 'active' && target.status !== 'stale')) continue
    const next: Memory = { ...target, status: 'superseded', staleReason: undefined, supersededBy: memory.id, revision: target.revision + 1, updatedAt: op.now }
    writeMemory(op.store.db, next)
    syncEdges(op.store.db, next, op.now)
    moved.push(id)
  }
  return moved
}

/**
 * The live memories of the draft's scope, audience and owner whose whole text or one of whose
 * sentences is at `SIMILAR_COSINE` or closer to the draft, best first, without the ones the draft
 * replaces. Measured on the mpnet model over 194 real memories: a translation or a paraphrase of a
 * memory reached 0.73 to 0.96 of it, and ranked it first in 28 of 28; a fact one sentence of a long
 * memory states reached 0.49 to 0.86; a case of a stored rule reached 0.60 to 0.70 of the rule; the same memory with another number
 * reached 0.89 to 0.99. Two distinct stored memories reached up to 0.85 and opposite preferences
 * 0.96, so no cosine merges alone, and the writer decides.
 */
function meaningSimilar(op: Op, draft: Draft, semantic: SemanticQuery | undefined): SimilarMemory[] {
  if (semantic === undefined) return []
  const visibility = { statuses: LIVE, policies: EVERY_POLICY, audienceScoped: true, allSessions: true, scope: draft.scope }
  const audience = audienceKey(draft)
  return vectorHits(op.store.db, semantic, visibility, Number.MAX_SAFE_INTEGER, true)
    .filter(hit => hit.cosine >= SIMILAR_COSINE && !draft.supersedes.includes(hit.memory.id))
    .filter(hit => audienceKey(hit.memory) === audience && (draft.ownerSessionId === undefined || hit.memory.ownerSessionId === draft.ownerSessionId))
    .map(hit => ({ id: hit.memory.id, kind: hit.memory.kind, text: hit.memory.text, cosine: Math.round(hit.cosine * 100) / 100 }))
}

/** The memories close in meaning first, then those close by words alone, each once, at most `MAX_SIMILAR`. */
function similarOf(op: Op, draft: Draft, semantic: SemanticQuery | undefined): SimilarMemory[] {
  const found = new Map(meaningSimilar(op, draft, semantic).map(similar => [similar.id, similar]))
  for (const memory of wordSimilar(op, draft)) if (!found.has(memory.id)) found.set(memory.id, { id: memory.id, kind: memory.kind, text: memory.text })
  return [...found.values()].slice(0, MAX_SIMILAR)
}

/**
 * Stores a memory under SAGE's rules. Runs inside the caller's transaction. The same text merges
 * into the stored memory. A write close to a live memory by words, or by meaning when the text's
 * embedding is given (`semantic`), is not written: the answer names the similar memories, and the
 * writer updates one or writes again with `distinct`.
 */
export function remember(op: Op, input: RememberInput, semantic?: SemanticQuery): RememberResult {
  rejectSecrets(input)
  const draft = draftOf(op, input, checkRemember(input))
  checkRelations(op, draft)
  const existing = exactMatch(op, draft)
  if (existing === undefined && input.distinct !== true) {
    const similar = similarOf(op, draft, semantic)
    if (similar.length > 0) return { outcome: 'similar', similar }
  }
  const memory = existing ? merged(op, existing, draft) : added(op, draft)
  writeMemory(op.store.db, memory)
  syncEdges(op.store.db, memory, op.now)
  return {
    memory,
    outcome: existing ? 'merged' : 'added',
    reactivated: existing?.status === 'stale',
    superseded: supersede(op, memory, draft.supersedes),
  }
}
