import type { Anchor, Audience, ContextPolicy, Kind, Memory, Persistence, RememberInput, RememberResult, Scope, Source } from '../hooks/shared/model.ts'
import { allTerms, canonicalText, normalizeTags } from '../hooks/shared/text.ts'
import { distinct, normalizeAnchors, normalizeSources } from './anchors.ts'
import { refused } from './errors.ts'
import { ftsTerms } from './fts.ts'
import { syncEdges } from './graph.ts'
import { storeLabel, type Op } from './op.ts'
import { assessQuality, checkRemember, clamp01, isNearDuplicate, isPossiblyContradictory, normalizeAudience, rejectSecrets } from './rules.ts'
import { audienceKey, readMemory, selectMemories, writeMemory } from './rows.ts'
import { ulid } from './ulid.ts'

/**
 * Writing a memory: a new record, or a merge into the live memory of the same scope and audience
 * that says the same thing (the same canonical text, or the same kind in other words). Ported
 * from SAGE's `rememberSage`, with one change: the memories the new one `supersedes` become
 * superseded by it.
 */

const DEFAULT_IMPORTANCE = 0.6
const DEFAULT_CONFIDENCE = 0.8

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
    ownerSessionId: scope === 'session' ? input.ownerSessionId : undefined,
    expiresAt: input.expiresAt,
  }
}

/** Every id a relationship names is a live memory of this store. */
export function checkRelations(op: Op, lists: { supersedes?: readonly string[]; contradicts?: readonly string[] }): void {
  for (const [name, list] of [['supersedes', lists.supersedes ?? []], ['contradicts', lists.contradicts ?? []]] as const) {
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
 * The strongest near-duplicate among the scope's 64 most important memories and the 32 the text
 * search ranks closest. A pair of opposite polarity is never one memory.
 */
function nearMatch(op: Op, draft: Draft): Memory | undefined {
  const owner = draft.ownerSessionId ?? null
  const audience = audienceKey(draft)
  const pool = new Map(selectMemories(op.store.db, BY_IMPORTANCE, draft.scope, audience, owner, owner).map(memory => [memory.id, memory]))
  const terms = ftsTerms(draft.text)
  if (terms.length > 0) {
    for (const memory of selectMemories(op.store.db, BY_TEXT, terms.join(' OR '), draft.scope, audience, owner, owner)) pool.set(memory.id, memory)
  }
  let best: { memory: Memory; score: number } | undefined
  for (const memory of pool.values()) {
    if (!isNearDuplicate(draft, memory) || isPossiblyContradictory(draft.text, memory.text)) continue
    const score = memory.importance * 2 + memory.confidence + memory.freshness
    if (!best || score > best.score) best = { memory, score }
  }
  return best?.memory
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
function mergedLists(existing: Memory, draft: Draft): Pick<Memory, 'tags' | 'anchors' | 'sources' | 'supersedes' | 'contradicts'> {
  return {
    tags: [...new Set([...existing.tags, ...draft.tags])],
    anchors: distinct([...existing.anchors, ...draft.anchors]),
    sources: distinct([...existing.sources, ...draft.sources]),
    supersedes: without([...new Set([...(existing.supersedes ?? []), ...draft.supersedes])], existing.id),
    contradicts: without([...new Set([...(existing.contradicts ?? []), ...draft.contradicts])], existing.id),
  }
}

/**
 * The existing memory with the new write folded in: unions of lists, the larger scores, its own
 * kind and history. A paraphrase keeps the richer wording, its terms counted with repeats as SAGE
 * compares them.
 */
function merged(op: Op, existing: Memory, draft: Draft, exact: boolean): Memory {
  const preferIncoming = !exact && allTerms(draft.text).length > allTerms(existing.text).length && draft.text.length > existing.text.length
  const reactivated = existing.status === 'stale'
  return {
    ...existing,
    ...mergedLists(existing, draft),
    status: reactivated ? 'active' : existing.status,
    staleReason: reactivated ? undefined : existing.staleReason,
    text: preferIncoming ? draft.text : existing.text,
    audience: draft.audience ?? existing.audience,
    importance: Math.max(existing.importance, draft.importance),
    confidence: Math.max(existing.confidence, draft.confidence),
    freshness: Math.max(existing.freshness, draft.freshness),
    persistence: mergedPersistence(existing.persistence, draft.persistence),
    contextPolicy: draft.contextPolicy ?? existing.contextPolicy,
    expiresAt: draft.expiresAt ?? existing.expiresAt,
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

/** Stores a memory under SAGE's rules. Runs inside the caller's transaction. */
export function remember(op: Op, input: RememberInput): RememberResult {
  rejectSecrets(input)
  const draft = draftOf(op, input, checkRemember(input))
  checkRelations(op, draft)
  const exact = exactMatch(op, draft)
  const existing = exact ?? nearMatch(op, draft)
  const memory = existing ? merged(op, existing, draft, exact !== undefined) : added(op, draft)
  writeMemory(op.store.db, memory)
  syncEdges(op.store.db, memory, op.now)
  return {
    memory,
    outcome: existing ? 'merged' : 'added',
    nearDuplicate: existing !== undefined && exact === undefined,
    reactivated: existing?.status === 'stale',
    superseded: supersede(op, memory, draft.supersedes),
  }
}
