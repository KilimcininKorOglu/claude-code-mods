import type { Anchor, Kind, Memory, Persistence } from '../hooks/shared/model.ts'
import { tokenize } from '../hooks/shared/text.ts'
import { clamp01 } from './rules.ts'

/**
 * How strongly a memory relates to what a reminder is about, on the one scale every retrieval
 * channel shares, and the reminder score that ranks the candidates. Ported from SAGE's retrieval
 * scoring, whose gates are calibrated to a relation floor of 0.85.
 */

export type Relevance = { strength: number; reasons: string[] }

const NONE: Relevance = { strength: 0, reasons: [] }

/** A tool reminder carries only a memory related at least this strongly. */
export const RELATION_FLOOR = 0.85
/** A tool reminder carries only a memory whose reminder score reaches this. */
export const MIN_SCORE = 0.65
/** A tool reminder carries only a memory at least this important. */
export const MIN_IMPORTANCE = 0.5
/** A prompt reminder needs this much relevance before its score counts. */
export const TURN_MIN_RELEVANCE = 0.62

/** Coding words that match nearly every memory, so they are no evidence of a relation. */
const GENERIC_TERMS = new Set([
  'add',
  'after',
  'and',
  'are',
  'backfill',
  'bash',
  'before',
  'change',
  'code',
  'command',
  'context',
  'edit',
  'file',
  'files',
  'find',
  'fix',
  'for',
  'from',
  'glob',
  'grep',
  'imported',
  'inject',
  'injected',
  'injector',
  'legacy',
  'memory',
  'model',
  'node',
  'output',
  'package',
  'packages',
  'path',
  'project',
  'provider',
  'read',
  'recovered',
  'recovery',
  'remove',
  'result',
  'results',
  'restored',
  'run',
  'source',
  'src',
  'test',
  'tests',
  'that',
  'the',
  'this',
  'tool',
  'tree',
  'update',
  'using',
  'with',
  'write',
])

function informativeTerms(text: string): string[] {
  const terms = tokenize(text).map(term => term.replace(/^[._-]+|[._-]+$/g, ''))
  return [...new Set(terms.filter(term => term.length >= 3 && !GENERIC_TERMS.has(term)))]
}

/** An anchor's own value as a query would spell it; too short a value matches by accident. */
function exactAnchorValue(anchor: Anchor): string | undefined {
  const value = anchor.symbol ?? anchor.command ?? anchor.path ?? anchor.role
  if (!value) return undefined
  const normalized = value.normalize('NFKC').toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '')
  return normalized === '.' || normalized.length < 4 ? undefined : normalized
}

function exactAnchorMatch(memory: Memory, normalizedQuery: string): Relevance | undefined {
  for (const anchor of memory.anchors) {
    const exact = exactAnchorValue(anchor)
    if (exact && normalizedQuery.includes(exact)) {
      return { strength: anchor.type === 'symbol' || anchor.type === 'command' ? 0.98 : 0.96, reasons: [`query:exact-${anchor.type}`] }
    }
  }
  return undefined
}

type Matches = { matched: string[]; anchor: string[]; tag: string[]; answers: boolean; queryCount: number }

/**
 * The query terms a memory holds in its text, tags, and symbol, command or role anchors. An
 * anchor path is matched as a path, never word by word, or a memory about one `store.ts` would
 * match every other.
 */
function termMatches(memory: Memory, queryTerms: readonly string[]): Matches {
  const text = new Set(informativeTerms(memory.text))
  const tags = new Set(memory.tags.flatMap(informativeTerms))
  const anchors = new Set(memory.anchors.flatMap(anchor => informativeTerms([anchor.symbol, anchor.command, anchor.role].filter(Boolean).join(' '))))
  const matched = queryTerms.filter(term => text.has(term) || tags.has(term) || anchors.has(term))
  return {
    matched,
    anchor: matched.filter(term => anchors.has(term)),
    tag: matched.filter(term => tags.has(term)),
    answers: matched.length / queryTerms.length >= 0.6 || matched.length >= 4,
    queryCount: queryTerms.length,
  }
}

type Tier = { applies: (matches: Matches) => boolean; strength: (matches: Matches) => number }

/**
 * Evidence tiers, first match wins. What lifts a tier is how much of the question the shared
 * words answer: three of a three-word search is the memory asked for, three of a twelve-term
 * path query is a coincidence. One word out of a short query sits below the relation floor, so
 * it can reach a prompt reminder and never a tool reminder.
 */
const TIERS: readonly Tier[] = [
  { applies: m => m.anchor.length >= 2, strength: m => Math.min(0.92, 0.78 + m.anchor.length * 0.05) },
  { applies: m => m.anchor.length === 1, strength: m => (m.answers ? 0.82 : 0.72) },
  { applies: m => m.tag.length >= 2, strength: m => Math.min(0.88, 0.74 + m.tag.length * 0.05) },
  { applies: m => m.tag.length === 1, strength: m => (m.answers ? 0.78 : 0.7) },
  { applies: m => m.matched.length >= 3, strength: m => (m.answers ? Math.min(0.86, 0.76 + m.matched.length * 0.02) : 0.72) },
  { applies: m => m.matched.length === 2, strength: m => (m.answers ? 0.72 : 0.68) },
  { applies: m => m.queryCount <= 2, strength: () => 0.66 },
]

function evidenceOf(matches: Matches): string[] {
  const reasons: string[] = []
  if (matches.anchor.length > 0) reasons.push(`query:anchor-terms:${matches.anchor.slice(0, 3).join(',')}`)
  if (matches.tag.length > 0) reasons.push(`query:tag-terms:${matches.tag.slice(0, 3).join(',')}`)
  reasons.push(`query:text-terms:${matches.matched.slice(0, 4).join(',')}`)
  return reasons
}

/**
 * The concrete evidence a query holds for a memory: an anchor value spelled out in the query, or
 * shared informative terms. Metadata never manufactures relevance.
 */
export function memoryQueryRelevance(memory: Memory, query: string): Relevance {
  const queryTerms = informativeTerms(query)
  if (queryTerms.length === 0) return NONE
  const exact = exactAnchorMatch(memory, query.normalize('NFKC').toLowerCase().replace(/\\/g, '/'))
  if (exact) return exact
  const matches = termMatches(memory, queryTerms)
  if (matches.matched.length === 0) return NONE
  const tier = TIERS.find(candidate => candidate.applies(matches))
  return tier ? { strength: tier.strength(matches), reasons: evidenceOf(matches) } : NONE
}

function structuralKeys(memory: Memory): Set<string> {
  const keys = new Set<string>()
  for (const anchor of memory.anchors) {
    const value = exactAnchorValue(anchor)
    if (value) keys.add(`${anchor.type}:${value}`)
  }
  return keys
}

/** The corroboration a graph neighbour needs: an anchor it shares with a seed, or two shared tags. */
export function memoryStructuralRelevance(memory: Memory, seeds: readonly Memory[]): Relevance {
  const keys = structuralKeys(memory)
  const tags = new Set(memory.tags.flatMap(informativeTerms))
  for (const seed of seeds) {
    const shared = [...structuralKeys(seed)].find(key => keys.has(key))
    if (shared) return { strength: 0.86, reasons: [`graph:shared-anchor:${shared}`] }
    const sharedTags = [...new Set(seed.tags.flatMap(informativeTerms))].filter(tag => tags.has(tag))
    if (sharedTags.length >= 2) return { strength: 0.72, reasons: [`graph:shared-tags:${sharedTags.slice(0, 3).join(',')}`] }
  }
  return NONE
}

/** A top-level directory anchor is too broad to relate to a path below it. */
const MIN_ANCESTOR_SEGMENTS = 2
const ANCESTOR_DECAY_PER_SEGMENT = 0.11

function anchorPathRelation(anchor: Anchor, relPath: string, depth: number): Relevance | undefined {
  const path = anchor.path
  if (!path) return undefined
  if (path === relPath) {
    return { strength: anchor.type === 'symbol' || anchor.type === 'command' ? 0.98 : 0.95, reasons: [`anchor:exact-${anchor.type}:${path}`] }
  }
  const segments = path.split('/').filter(Boolean).length
  if (!relPath.startsWith(`${path}/`) || segments < MIN_ANCESTOR_SEGMENTS) return undefined
  const distance = depth - segments
  return { strength: Math.max(0.35, 0.95 - distance * ANCESTOR_DECAY_PER_SEGMENT), reasons: [`anchor:ancestor:${path}+${distance}`] }
}

/**
 * How strongly a memory's anchors relate to a path the tool touched: the path itself (a symbol in
 * it the strongest), or a directory above it, weaker with each level. Every anchor that carries a
 * path counts, and the strongest wins whatever the anchor order.
 */
export function pathAnchorRelation(memory: Memory, relPath: string): Relevance | undefined {
  if (!relPath || relPath === '.') return undefined
  const depth = relPath.split('/').filter(Boolean).length
  let best: Relevance | undefined
  for (const anchor of memory.anchors) {
    const found = anchorPathRelation(anchor, relPath, depth)
    if (found && (!best || found.strength > best.strength)) best = found
  }
  return best
}

/** The memory's own weight, before any relation: importance counts most. */
export function metadataScore(memory: Memory): number {
  return (memory.importance * 3 + memory.confidence * 2 + memory.freshness) / 6
}

const PERSISTENCE_BOOST: Record<Persistence, number> = { permanent: 0.08, long_lived: 0.04, short_lived: -0.08 }

const DURABLE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'fact',
  'decision',
  'convention',
  'warning',
  'anti_pattern',
  'workflow',
  'bug_root_cause',
  'file_note',
  'symbol_note',
  'command_note',
  'tool_outcome',
  'error_pattern',
  'role_operational',
  'task_outcome',
  'security_signal',
  'fleet_convention',
])

/** A memory the model drew on gains; one reminded three times and never used loses. */
function usageTerm(memory: Memory): number {
  const uses = memory.useCount ?? 0
  const reminders = memory.reminderCount ?? 0
  if (uses > 0) return Math.min(0.14, 0.05 + uses * 0.02)
  return reminders >= 3 ? -Math.min(0.18, 0.05 + reminders * 0.012) : 0
}

/**
 * The score a tool reminder ranks and gates by: metadata and relation weigh alike, then
 * persistence, a durable kind, use, and anchoring move it a little. Clamped to 0..1.
 */
export function reminderScore(memory: Memory, relationStrength: number): number {
  const raw =
    metadataScore(memory) * 0.48 +
    relationStrength * 0.48 +
    PERSISTENCE_BOOST[memory.persistence] +
    (DURABLE_KINDS.has(memory.kind) ? 0.04 : 0) +
    usageTerm(memory) +
    (memory.anchors.length > 0 ? 0.04 : -0.05)
  return clamp01(raw)
}

/** How much of a prompt reminder's score the metadata alone carries; relevance carries the rest. */
const METADATA_WEIGHT = 0.3

/** The score a prompt reminder gates by: the metadata scaled by relevance, then use and anchoring. */
export function turnScore(memory: Memory, relevance: number): number {
  const uses = memory.useCount ?? 0
  const reminders = memory.reminderCount ?? 0
  const useBoost = uses > 0 ? Math.min(0.1, 0.04 + uses * 0.015) : 0
  const unusedPenalty = reminders >= 3 && uses === 0 ? Math.min(0.12, 0.03 + reminders * 0.01) : 0
  const anchorBoost = memory.anchors.length > 0 ? 0.03 : -0.04
  return clamp01(metadataScore(memory) * (METADATA_WEIGHT + relevance * (1 - METADATA_WEIGHT)) + useBoost + anchorBoost - unusedPenalty)
}
