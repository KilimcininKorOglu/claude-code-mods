import type { Memory, Ranked, Ranking, Rejection, Status, SubagentRanking } from '../hooks/shared/model.ts'
import { textKey } from '../hooks/shared/text.ts'
import { remindedIn } from './contexts.ts'
import type { Op } from './op.ts'
import { descending } from './order.ts'
import { findRelated } from './related.ts'
import {
  MIN_IMPORTANCE,
  MIN_SCORE,
  RELATION_FLOOR,
  TURN_MIN_RELEVANCE,
  memoryQueryRelevance,
  memoryStructuralRelevance,
  pathAnchorRelation,
  reminderScore,
  turnScore,
} from './relevance.ts'
import { alwaysMemories, memoriesForAudience, memoriesForPaths, relativePaths } from './retrieve.ts'
import { REMINDED_POLICY, interleave, searchStore, type Visibility } from './search.ts'

/**
 * Ranking the memories a reminder may carry, for the three moments a reminder goes out: after a
 * batch of file tools, with the person's prompt, and when a subagent starts. The hooks module
 * then leaves out what the context already shows, fits the rest to its budget and records what
 * it sent. Ported from SAGE's tool-result and turn-context middlewares.
 */

/** The two stores a reminder reads, the session it is for, and the loop whose context it goes to. */
export type Readers = { project: Op; user: Op; sessionId?: string; loop?: string }

type Found = { memory: Memory; op: Op; relationStrength: number; reasons: string[] }

type Gate = (item: Ranked) => Rejection | undefined

/** At most this many rejections are reported with their reason. */
const MAX_REJECTED = 20
/** At most this many candidates are answered; the hooks module keeps far fewer. */
const MAX_CANDIDATES = 64
/** A memory found this strongly by an anchor or an exact anchor value seeds the graph walk. */
const GRAPH_SEED_STRENGTH = 0.9

function visibilityFor(readers: Readers, statuses: readonly Status[]): Visibility {
  return { statuses, policies: REMINDED_POLICY, audienceScoped: false, sessionId: readers.sessionId }
}

/** Keeps the stronger evidence for a memory two channels found, and the reasons of both. */
function addFound(found: Map<string, Found>, item: Found): void {
  const existing = found.get(item.memory.id)
  if (!existing) {
    found.set(item.memory.id, item)
    return
  }
  existing.relationStrength = Math.max(existing.relationStrength, item.relationStrength)
  existing.reasons = [...new Set([...existing.reasons, ...item.reasons])]
}

function fixed(value: number): string {
  return value.toFixed(2)
}

function rejection(item: Ranked, gate: Rejection['gate'], reason: string): Rejection {
  return { id: item.memory.id, gate, reason }
}

/** Two memories with the same text are one reminder: the better ranked one stays. */
function duplicateGate(): Gate {
  const seen = new Set<string>()
  return item => {
    const key = textKey(item.memory.text)
    if (seen.has(key)) return rejection(item, 'duplicate', 'the same text as a better ranked candidate')
    seen.add(key)
    return undefined
  }
}

function remindedGate(reminded: ReadonlySet<string>): Gate {
  return item => (reminded.has(item.memory.id) ? rejection(item, 'reminded', 'this context was already reminded of it') : undefined)
}

function toolScoreGate(item: Ranked): Rejection | undefined {
  if (item.memory.importance < MIN_IMPORTANCE) return rejection(item, 'belowScore', `importance ${fixed(item.memory.importance)} is below ${fixed(MIN_IMPORTANCE)}`)
  if (item.relationStrength < RELATION_FLOOR) return rejection(item, 'belowScore', `relation ${fixed(item.relationStrength)} is below ${fixed(RELATION_FLOOR)}`)
  return item.score < MIN_SCORE ? rejection(item, 'belowScore', `score ${fixed(item.score)} is below ${fixed(MIN_SCORE)}`) : undefined
}

function turnScoreGate(item: Ranked): Rejection | undefined {
  if (item.relationStrength < TURN_MIN_RELEVANCE) return rejection(item, 'belowScore', `relevance ${fixed(item.relationStrength)} is below ${fixed(TURN_MIN_RELEVANCE)}`)
  return item.score < MIN_SCORE ? rejection(item, 'belowScore', `score ${fixed(item.score)} is below ${fixed(MIN_SCORE)}`) : undefined
}

/** Runs each candidate, best first, through the gates in order; the first gate that holds it back says why. */
function applyGates(ranked: readonly Ranked[], gates: readonly Gate[]): Ranking {
  const candidates: Ranked[] = []
  const rejected: Rejection[] = []
  for (const item of ranked) {
    let held: Rejection | undefined
    for (const gate of gates) {
      held = gate(item)
      if (held) break
    }
    if (!held) candidates.push(item)
    else if (rejected.length < MAX_REJECTED) rejected.push(held)
  }
  return { candidates: candidates.slice(0, MAX_CANDIDATES), rejected }
}

function byScore(left: Ranked, right: Ranked): number {
  return right.score - left.score
}

export type ToolsRequest = {
  /** The paths the batch's tools touched, absolute or relative to the project root. */
  paths: readonly string[]
  /** The paths spelled out as terms, the tools' patterns, and the tasks in progress. */
  query: string
  /** A tool changed a file: memories verification marked stale come too, to be checked. */
  mutation: boolean
  /** How many memories the reminder may carry. */
  limit: number
}

/** Memories anchored to a touched path, a symbol in it or a directory above it. */
function pathChannel(readers: Readers, request: ToolsRequest, statuses: readonly Status[], found: Map<string, Found>): void {
  const { root } = readers.project
  if (root === undefined) return
  for (const path of relativePaths(root, request.paths)) {
    for (const memory of memoriesForPaths(readers.project, [path], visibilityFor(readers, statuses), request.limit * 2)) {
      const relation = pathAnchorRelation(memory, path)
      if (relation) addFound(found, { memory, op: readers.project, relationStrength: relation.strength, reasons: relation.reasons })
    }
  }
}

/** Memories the query finds in either store, each weighed by the evidence the query holds for it. */
function queryChannel(readers: Readers, request: ToolsRequest, found: Map<string, Found>): void {
  if (request.query.trim() === '') return
  const limit = Math.max(request.limit * 8, 64)
  for (const op of [readers.project, readers.user]) {
    for (const memory of searchStore(op.store.db, request.query, visibilityFor(readers, ['active']), limit)) {
      const relevance = memoryQueryRelevance(memory, request.query)
      addFound(found, { memory, op, relationStrength: relevance.strength, reasons: relevance.reasons.length > 0 ? relevance.reasons : ['query:insufficient-evidence'] })
    }
  }
}

function isGraphSeed(item: Found): boolean {
  return item.relationStrength >= GRAPH_SEED_STRENGTH && item.reasons.some(reason => reason.startsWith('anchor:') || reason.startsWith('query:exact-'))
}

/** The graph neighbours of the strongest finds, when they share an anchor or two tags with one. */
function graphChannel(readers: Readers, request: ToolsRequest, statuses: readonly Status[], found: Map<string, Found>): void {
  const seeds = [...found.values()].filter(isGraphSeed)
  const seedMemories = seeds.map(seed => seed.memory)
  for (const op of [readers.project, readers.user]) {
    const ids = seeds.filter(seed => seed.op === op).map(seed => seed.memory.id)
    if (ids.length === 0) continue
    for (const memory of findRelated(op, ids, { visibility: visibilityFor(readers, statuses), limit: request.limit * 2, maxDepth: 2 })) {
      const relevance = memoryStructuralRelevance(memory, seedMemories)
      if (!found.has(memory.id) && relevance.strength >= RELATION_FLOOR) found.set(memory.id, { memory, op, relationStrength: relevance.strength, reasons: relevance.reasons })
    }
  }
}

/**
 * The memories a reminder after a tool batch may carry, best reminder score first. A read
 * reminds of active memories; a change reminds of stale ones too. A memory held back by a gate
 * is reported with the reason: a repeated text, too little importance, relation or score, or a
 * context that was already reminded of it.
 */
export function rankForTools(readers: Readers, request: ToolsRequest): Ranking {
  const statuses: Status[] = request.mutation ? ['active', 'stale'] : ['active']
  const found = new Map<string, Found>()
  pathChannel(readers, request, statuses, found)
  queryChannel(readers, request, found)
  graphChannel(readers, request, statuses, found)
  const ranked = [...found.values()]
    .filter(item => statuses.includes(item.memory.status) && item.memory.kind !== 'memory_review')
    .map(item => ({ memory: item.memory, relationStrength: item.relationStrength, score: reminderScore(item.memory, item.relationStrength), reasons: item.reasons }))
    .sort(byScore)
  return applyGates(ranked, [duplicateGate(), toolScoreGate, remindedGate(remindedIn(readers.project.store.db, readers.sessionId, readers.loop))])
}

export type PromptRequest = { query: string; limit: number }

/**
 * The memories a reminder with the person's prompt may carry: what the prompt's text finds in
 * either store, relevant enough and scored high enough, best first.
 */
export function rankForPrompt(readers: Readers, request: PromptRequest): Ranking {
  if (request.query.trim() === '') return { candidates: [], rejected: [] }
  const visibility = visibilityFor(readers, ['active'])
  const hits = interleave(searchStore(readers.project.store.db, request.query, visibility, request.limit), searchStore(readers.user.store.db, request.query, visibility, request.limit))
  const ranked = hits
    .filter(memory => memory.kind !== 'memory_review')
    .map(memory => {
      const relevance = memoryQueryRelevance(memory, request.query)
      return { memory, relationStrength: relevance.strength, score: turnScore(memory, relevance.strength), reasons: relevance.reasons }
    })
    .sort(byScore)
  const ranking = applyGates(ranked, [duplicateGate(), turnScoreGate, remindedGate(remindedIn(readers.project.store.db, readers.sessionId, readers.loop))])
  return { candidates: ranking.candidates.slice(0, request.limit), rejected: ranking.rejected }
}

/** Most important first, the newer change breaking a tie. */
function byImportance(left: Memory, right: Memory): number {
  return right.importance - left.importance || descending(left.updatedAt, right.updatedAt)
}

export type SubagentRequest = { role?: string; mode?: string; task: string; audienceLimit: number; taskLimit: number }

/**
 * What a subagent starts with: the active memories written for its role or mode (a stale one
 * takes no place), then the memories its task's text finds. A new subagent's context holds
 * nothing yet, so no earlier reminder is left out.
 */
export function rankForSubagent(readers: Readers, request: SubagentRequest): SubagentRanking {
  const context = { role: request.role, mode: request.mode }
  const audience = [readers.project, readers.user]
    .flatMap(op => memoriesForAudience(op, context, readers.sessionId, request.audienceLimit))
    .sort(byImportance)
    .slice(0, request.audienceLimit)
  const task = rankForPrompt({ ...readers, loop: undefined }, { query: request.task, limit: request.taskLimit }).candidates
  return { audience, task }
}

/** The memories marked `always` in both stores, most important first. */
export function alwaysFor(readers: Readers, limit: number): Memory[] {
  return [readers.project, readers.user]
    .flatMap(op => alwaysMemories(op, readers.sessionId, limit))
    .sort(byImportance)
    .slice(0, limit)
}
