import type { Memory, Ranked, Ranking, Rejection, SearchHit, Status, SubagentRanking } from '../hooks/shared/model.ts'
import { textKey } from '../hooks/shared/text.ts'
import { remindedAt, remindedIn } from './contexts.ts'
import { searchHybrid, searchWithCosines } from './hybrid.ts'
import type { Op } from './op.ts'
import { descending } from './order.ts'
import { findRelated } from './related.ts'
import { MEANING_FLOOR_COSINE, MIN_IMPORTANCE, MIN_SCORE, RELATION_FLOOR, TURN_MIN_RELEVANCE, hitRelevance, memoryStructuralRelevance, promptRelevance, pathAnchorRelation, reminderScore, turnScore } from './relevance.ts'
import { namedMemories, type Named } from './named.ts'
import { memoriesAmong, memoriesForAudience, memoriesForPaths, relativePaths } from './retrieve.ts'
import { selectMemories, sql } from './rows.ts'
import { isAbsolute, join } from 'node:path'
import { rebase } from './nested.ts'
import { REMINDED_POLICY, type Visibility } from './search.ts'
import type { SemanticQuery } from './vectors.ts'
import { wordEvidence, type WordEvidence } from './words.ts'

/**
 * Ranking the memories a reminder may carry, for the three moments a reminder goes out: on a file
 * tool's result, with the person's prompt, and when a subagent starts. The hooks module
 * then leaves out what the context already shows, fits the rest to its budget and records what
 * it sent. Ported from SAGE's tool-result and turn-context middlewares.
 */

/**
 * The stores a reminder reads (the project's, the user's, and `nested`: the project stores above
 * or below the project's root, each op with its own root), the session it is for, the loop whose
 * context it goes to, and the vector of its query while embeddings are on.
 */
export type Readers = { project: Op; user: Op; nested?: readonly Op[]; sessionId?: string; loop?: string; semantic?: SemanticQuery }

/** The project stores a reminder reads: the project's own first, then the ones above or below it. */
function projectOps(readers: Readers): Op[] {
  return [readers.project, ...(readers.nested ?? [])]
}

/** Every store a reminder reads, the project's first. */
function allOps(readers: Readers): Op[] {
  return [readers.project, readers.user, ...(readers.nested ?? [])]
}

/** The store that holds a memory: the user's for a user memory, else the project store whose rows hold its id. */
function opOf(readers: Readers, memory: Memory): Op {
  if (memory.scope === 'user') return readers.user
  return projectOps(readers).find(op => sql(op.store.db, 'SELECT 1 FROM memories WHERE id = ?').get(memory.id) !== undefined) ?? readers.project
}

/**
 * A memory as the session sees it: one of a project store above or below the project has its anchor
 * paths rebased from that store's root to the project's, so its `about` names the file the session
 * opens, and an edit of that file counts as its use.
 */
function asSeen(readers: Readers, memory: Memory): Memory {
  const from = opOf(readers, memory).root
  const to = readers.project.root
  if (memory.scope === 'user' || from === undefined || to === undefined || from === to) return memory
  return { ...memory, anchors: memory.anchors.map(anchor => (anchor.path === undefined ? anchor : { ...anchor, path: rebase(anchor.path, from, to) })) }
}

/** The ranking with each memory as the session sees it. */
function seen(readers: Readers, ranking: Ranking): Ranking {
  if ((readers.nested ?? []).length === 0) return ranking
  return { ...ranking, candidates: ranking.candidates.map(item => ({ ...item, memory: asSeen(readers, item.memory) })) }
}

type Found = { memory: Memory; op: Op; relationStrength: number; reasons: string[] }

type Gate = (item: Ranked) => Rejection | undefined

/** At most this many rejections are reported with their reason. */
const MAX_REJECTED = 20
/** At most this many candidates are answered; the hooks module keeps far fewer. */
const MAX_CANDIDATES = 64
/**
 * How many memories anchored to a path or a directory above it are read before their relation is
 * weighed. The read sorts by importance, so a smaller cut dropped a file's own memory behind the
 * important memories of a directory above it.
 */
const PATH_FETCH = 1000
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

/**
 * A prompt reminder holds back on relevance, then on the importance floor alone. A score gate held
 * back 22 of 112 wanted memories of 57 measured prompts: a memory of the default importance (0.6)
 * without an anchor scored 0.647 at the strongest meaning match, under the 0.65 gate. Word evidence
 * needs no score either: the store's own counts already decide whether the words single it out.
 */
function turnScoreGate(item: Ranked): Rejection | undefined {
  if (item.relationStrength < TURN_MIN_RELEVANCE) return rejection(item, 'belowScore', `relevance ${fixed(item.relationStrength)} is below ${fixed(TURN_MIN_RELEVANCE)}`)
  return item.memory.importance < MIN_IMPORTANCE ? rejection(item, 'belowScore', `importance ${fixed(item.memory.importance)} is below ${fixed(MIN_IMPORTANCE)}`) : undefined
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

/**
 * Stronger relation first, the reminder score breaking a tie. The score weighs importance about seven
 * times a relation step (importance 1 against 0.6 moved it 0.1, a relation of 0.95 against 0.92 0.014)
 * and stops at 1, so by score alone the important memories of a directory above a file ranked before
 * the file's own memory.
 */
function byRelation(left: Ranked, right: Ranked): number {
  return right.relationStrength - left.relationStrength || byScore(left, right)
}

/**
 * A memory anchored where the tool worked first, then one the query alone found, each by relation. The
 * query of a tool reminder is the path spelled as words, so its matches (a word, a tag, a cosine) reached
 * 0.94 for memories of other files and outranked a directory anchor's 0.92. `placed` holds the memories
 * whose anchor alone reaches the relation floor; an anchor past its reach places nothing.
 */
/**
 * Memories that took one memory's place together (the parts of a split, which name it alone in
 * `supersedes`) are siblings. Every first sibling comes before every second one, each group in its
 * tier order (`tierOf`: the anchored memories of a file before the ones a query found), so one
 * split memory does not fill a block. On a store copy whose 227 long memories were split into 1,792
 * parts, the file tool's 8 places held 6.48 second parts per call and 25 of the 77 wanted memories
 * came; with the spread 58 came, against 56 before the split. Nothing is dropped.
 */
export function spreadSiblings<T extends Ranked>(items: readonly T[], tierOf: (item: T) => number = () => 0): T[] {
  const seen = new Map<string, number>()
  const keyed = items.map((item, index) => {
    const key = item.memory.supersedes?.length === 1 ? item.memory.supersedes[0]! : item.memory.id
    const nth = seen.get(key) ?? 0
    seen.set(key, nth + 1)
    return { item, index, nth, tier: tierOf(item) }
  })
  return keyed.sort((a, b) => Math.min(a.nth, 1) - Math.min(b.nth, 1) || a.tier - b.tier || a.index - b.index).map(entry => entry.item)
}

function byPlacement(placed: ReadonlySet<string>): (left: Ranked, right: Ranked) => number {
  return (left, right) => Number(placed.has(right.memory.id)) - Number(placed.has(left.memory.id)) || byRelation(left, right)
}

export type ToolsRequest = {
  /** The paths the file tool touched, absolute or relative to the project root. */
  paths: readonly string[]
  /** The paths spelled out as terms, the tools' patterns, and the tasks in progress. */
  query: string
  /** A tool changed a file: memories verification marked stale come too, to be checked. */
  mutation: boolean
  /** How many memories the reminder may carry. */
  limit: number
}

/**
 * Memories anchored to a touched path, a symbol in it or a directory above it. Each one whose anchor
 * alone reaches the relation floor joins `placed`.
 */
function pathChannel(readers: Readers, request: ToolsRequest, statuses: readonly Status[], found: Map<string, Found>, placed: Set<string>): void {
  const { root } = readers.project
  if (root === undefined) return
  // Each store's anchors are written from its own root, so every store reads the paths from its own.
  const absolute = request.paths.map(path => (isAbsolute(path) ? path : join(root, path)))
  for (const op of projectOps(readers)) {
    if (op.root === undefined) continue
    for (const path of relativePaths(op.root, absolute)) {
      for (const memory of memoriesForPaths(op, [path], visibilityFor(readers, statuses), PATH_FETCH)) {
        const relation = pathAnchorRelation(memory, path)
        if (!relation) continue
        addFound(found, { memory, op, relationStrength: relation.strength, reasons: relation.reasons })
        if (relation.strength >= RELATION_FLOOR) placed.add(memory.id)
      }
    }
  }
}

function hitsFor(readers: Readers, query: string, visibility: Visibility, limit: number): SearchHit[] {
  return searchHybrid(allOps(readers).map(op => op.store.db), query, visibility, limit, readers.semantic, MEANING_FLOOR_COSINE)
}

/** Memories the query finds in either store, each weighed by the stronger of its lexical and semantic evidence. */
function queryChannel(readers: Readers, request: ToolsRequest, found: Map<string, Found>): void {
  if (request.query.trim() === '') return
  for (const hit of hitsFor(readers, request.query, visibilityFor(readers, ['active']), Math.max(request.limit * 8, 64))) {
    const relevance = hitRelevance(hit, request.query)
    const reasons = relevance.reasons.length > 0 ? relevance.reasons : ['query:insufficient-evidence']
    addFound(found, { memory: hit.memory, op: opOf(readers, hit.memory), relationStrength: relevance.strength, reasons })
  }
}

function isGraphSeed(item: Found): boolean {
  return item.relationStrength >= GRAPH_SEED_STRENGTH && item.reasons.some(reason => reason.startsWith('anchor:') || reason.startsWith('query:exact-'))
}

/** The graph neighbours of the strongest finds, when they share an anchor or two tags with one. */
function graphChannel(readers: Readers, request: ToolsRequest, statuses: readonly Status[], found: Map<string, Found>): void {
  const seeds = [...found.values()].filter(isGraphSeed)
  const seedMemories = seeds.map(seed => seed.memory)
  for (const op of allOps(readers)) {
    const ids = seeds.filter(seed => seed.op === op).map(seed => seed.memory.id)
    if (ids.length === 0) continue
    for (const memory of findRelated(op, ids, { visibility: visibilityFor(readers, statuses), limit: request.limit * 2, maxDepth: 2 })) {
      const relevance = memoryStructuralRelevance(memory, seedMemories)
      if (!found.has(memory.id) && relevance.strength >= RELATION_FLOOR) found.set(memory.id, { memory, op, relationStrength: relevance.strength, reasons: relevance.reasons })
    }
  }
}

/**
 * The memories a reminder on a file tool's result may carry, best reminder score first. A read
 * reminds of active memories; a change reminds of stale ones too. A memory held back by a gate
 * is reported with the reason: a repeated text, too little importance, relation or score, or a
 * context that was already reminded of it.
 */
export function rankForTools(readers: Readers, request: ToolsRequest): Ranking {
  const statuses: Status[] = request.mutation ? ['active', 'stale'] : ['active']
  const found = new Map<string, Found>()
  const placed = new Set<string>()
  pathChannel(readers, request, statuses, found, placed)
  queryChannel(readers, request, found)
  graphChannel(readers, request, statuses, found)
  const ranked = [...found.values()]
    .filter(item => statuses.includes(item.memory.status) && item.memory.kind !== 'memory_review')
    .map(item => ({ memory: item.memory, relationStrength: item.relationStrength, score: reminderScore(item.memory, item.relationStrength), reasons: item.reasons }))
    .sort(byPlacement(placed))
  return seen(readers, applyGates(spreadSiblings(ranked, item => (placed.has(item.memory.id) ? 0 : 1)), [duplicateGate(), toolScoreGate, remindedGate(remindedIn(readers.project.store.db, readers.sessionId, readers.loop))]))
}

/** `blockCount` is how many memories the reminder's block carries: a name more memories hold singles none out. */
export type PromptRequest = { query: string; limit: number; blockCount: number }

/** The relevance of a memory the prompt names: as strong as a named anchor. */
const NAMED_STRENGTH = 0.96

/** Whether the prompt spells out one of the memory's anchors (a symbol, a command, a path). */
function namesAnchor(item: Ranked): boolean {
  return item.reasons.some(reason => reason.startsWith('query:exact-') && !reason.startsWith('query:exact-name:'))
}

/** What a prompt's ranking reads besides each hit: the named memories, the word evidence and the cosines of the project store's memories. */
type PromptEvidence = { named: ReadonlyMap<string, Named>; words: ReadonlyMap<string, WordEvidence>; cosines: ReadonlyMap<string, number> }

/**
 * Named memories first, the ones whose name fewer memories hold before the others; then a memory
 * whose anchor the prompt spells out; then the closer meaning, then the rarer word evidence, then
 * stronger relevance, the score breaking what is left. Meaning comes before relevance, because shared
 * words lifted a farther memory's relevance over a closer one's.
 */
function byMeaning(evidence: PromptEvidence): (left: Ranked, right: Ranked) => number {
  const holders = (item: Ranked): number => evidence.named.get(item.memory.id)?.holders ?? Number.POSITIVE_INFINITY
  const chance = (item: Ranked): number => evidence.words.get(item.memory.id)?.chance ?? Number.POSITIVE_INFINITY
  const cosine = (item: Ranked): number => evidence.cosines.get(item.memory.id) ?? 0
  return (left, right) =>
    holders(left) - holders(right) ||
    Number(namesAnchor(right)) - Number(namesAnchor(left)) ||
    cosine(right) - cosine(left) ||
    chance(left) - chance(right) ||
    right.relationStrength - left.relationStrength ||
    byScore(left, right)
}

/** A search hit's ranking entry; a named memory takes the named relevance whatever its words or meaning say. */
function promptEntry(hit: SearchHit, request: PromptRequest, withMeaning: boolean, evidence: PromptEvidence): Ranked {
  const name = evidence.named.get(hit.memory.id)
  const relevance = name
    ? { strength: NAMED_STRENGTH, reasons: [`query:exact-name:${name.name}`] }
    : promptRelevance(hit, request.query, evidence.words.get(hit.memory.id), withMeaning, MEANING_FLOOR_COSINE)
  return { memory: hit.memory, relationStrength: relevance.strength, score: turnScore(hit.memory, relevance.strength), reasons: relevance.reasons }
}

/**
 * The search hits, then each named memory and each memory with word evidence the search did not
 * return, with the cosine the vector scan gave it: a name or rare words reach a memory whatever its
 * rank in the search, which the best 48 by bm25 left out on a store of 300.
 */
function promptHits(readers: Readers, request: PromptRequest, named: ReadonlyMap<string, Named>, words: ReadonlyMap<string, WordEvidence>): { hits: SearchHit[]; cosines: ReadonlyMap<string, number> } {
  const visibility = visibilityFor(readers, ['active'])
  const search = searchWithCosines(allOps(readers).map(op => op.store.db), request.query, visibility, request.limit * 2, readers.semantic, MEANING_FLOOR_COSINE)
  const hits = search.hits.filter(hit => hit.memory.kind !== 'memory_review')
  const found = new Set(hits.map(hit => hit.memory.id))
  const unfound = (memory: Memory): boolean => !found.has(memory.id) && memory.kind !== 'memory_review'
  const worded = [...words.keys()].filter(id => !named.has(id))
  const fromWords = projectOps(readers).flatMap(op => memoriesAmong(op, worded, visibility, words.size))
  const extra = [...[...named.values()].map(item => item.memory), ...fromWords].filter(unfound)
  const added = extra.map(memory => ({ memory, lexicalScore: null, vectorScore: search.cosines.get(memory.id) ?? null, finalScore: 0, source: 'lexical' as const }))
  return { hits: [...hits, ...added], cosines: search.cosines }
}

/**
 * The memories a reminder with the person's prompt may carry: the memories the prompt names, then
 * what the prompt's words or meaning find in either store, relevant enough and important enough.
 * Only the project store is named and counted for words: the user store's memories reach every
 * context on their own.
 */
export function rankForPrompt(readers: Readers, request: PromptRequest): Ranking {
  if (request.query.trim() === '') return { candidates: [], rejected: [] }
  const visibility = visibilityFor(readers, ['active'])
  const dbs = projectOps(readers).map(op => op.store.db)
  const named = new Map(namedMemories(dbs, request.query, visibility, request.blockCount).map(item => [item.memory.id, item]))
  // Each store counts its own words: a word's rarity is read against the memories it was written beside.
  const words = new Map(dbs.flatMap(db => [...wordEvidence(db, request.query, visibility)]))
  const { hits, cosines } = promptHits(readers, request, named, words)
  const evidence = { named, words, cosines }
  const ranked = spreadSiblings(hits.map(hit => promptEntry(hit, request, readers.semantic !== undefined, evidence)).sort(byMeaning(evidence)))
  const ranking = applyGates(ranked, [duplicateGate(), turnScoreGate, remindedGate(remindedIn(readers.project.store.db, readers.sessionId, readers.loop))])
  return seen(readers, { candidates: ranking.candidates.slice(0, request.limit), rejected: ranking.rejected })
}

/** Most important first, the newer change breaking a tie. */
function byImportance(left: Memory, right: Memory): number {
  return right.importance - left.importance || descending(left.updatedAt, right.updatedAt)
}

/** Every active user memory for every context, most important first; a memory written for one audience, or set to `never`, takes its own path. */
const GLOBAL_RULES = `
  SELECT id, data FROM memories
  WHERE scope = 'user' AND status = 'active' AND context_policy = 'auto' AND audience IS NULL
  ORDER BY importance DESC, updated_at DESC`

/** The loop a global rules request is for: its session, its loop, and the project store that records its reminders. */
export type GlobalContext = { project: Op; sessionId: string; loop: string }

/**
 * The user's global rules: every active user memory, whatever the prompt or the task, with no count
 * or size limit. The user chose that a rule of the user scope reaches every context on its own
 * instead of waiting for a relevant prompt or file. For one loop's context, only the rules it was not
 * reminded of yet, or whose text changed since: a rule written or rewritten in another window while
 * the context was open comes with its next prompt, and the rest are not sent twice.
 */
export function globalRules(user: Op, context?: GlobalContext): Memory[] {
  const rules = selectMemories(user.store.db, GLOBAL_RULES)
  if (context === undefined) return rules
  const sent = remindedAt(context.project.store.db, context.sessionId, context.loop)
  return rules.filter(rule => {
    const at = sent.get(rule.id)
    return at === undefined || rule.updatedAt > at
  })
}

export type SubagentRequest ={ role?: string; mode?: string; task: string; audienceLimit: number; taskLimit: number }

/**
 * What a subagent starts with: the active memories written for its role or mode (a stale one
 * takes no place), then the memories its task's text finds. A new subagent's context holds
 * nothing yet, so no earlier reminder is left out.
 */
export function rankForSubagent(readers: Readers, request: SubagentRequest): SubagentRanking {
  const context = { role: request.role, mode: request.mode }
  const audience = allOps(readers)
    .flatMap(op => memoriesForAudience(op, context, readers.sessionId, request.audienceLimit))
    .sort(byImportance)
    .slice(0, request.audienceLimit)
  const task = rankForPrompt({ ...readers, loop: undefined }, { query: request.task, limit: request.taskLimit, blockCount: request.taskLimit }).candidates
  return { audience: audience.map(memory => asSeen(readers, memory)), task }
}
