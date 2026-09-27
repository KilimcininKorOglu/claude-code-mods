import type { DatabaseSync } from 'node:sqlite'
import { STATUSES, type Anchor, type GraphEdge, type Kind, type Memory, type Persistence } from '../hooks/shared/model.ts'
import { anchorNode, memoryNode } from './graph.ts'
import type { Op } from './op.ts'
import { ancestorPaths, slashes } from './paths.ts'
import { ABOUT_NODES, memoriesAmong, relativePaths } from './retrieve.ts'
import { selectMemories, sql } from './rows.ts'
import { EVERY_POLICY, searchStore, visibilityParams, type Visibility } from './search.ts'

/**
 * The memory graph read back: a walk over its edges, the graph around a query, and the memories
 * related to a set of seeds by the graph, a shared anchor, a shared tag or a command family.
 * Ported from SAGE.
 */

type EdgeRow = { from_node: string; to_node: string; relation: string; weight: number; created_at: string }

const EDGES_AT = `
  SELECT from_node, to_node, relation, weight, created_at FROM edges
  WHERE from_node IN (SELECT value FROM json_each(?)) OR to_node IN (SELECT value FROM json_each(?))`

type Walk = { nodes: Set<string>; edgeKeys: Set<string>; edges: GraphEdge[]; limit: number }

function otherEnd(row: EdgeRow, frontier: ReadonlySet<string>): string | undefined {
  const fromIn = frontier.has(row.from_node)
  const toIn = frontier.has(row.to_node)
  if (fromIn && !toIn) return row.to_node
  return toIn && !fromIn ? row.from_node : undefined
}

/** One step of the walk: every edge at the frontier, and the nodes it reaches first. */
function step(db: DatabaseSync, frontier: readonly string[], walk: Walk): string[] {
  const inFrontier = new Set(frontier)
  const list = JSON.stringify(frontier)
  const next: string[] = []
  for (const row of sql(db, EDGES_AT).all(list, list) as EdgeRow[]) {
    if (walk.edges.length >= walk.limit) break
    const key = `${row.from_node}\0${row.to_node}\0${row.relation}`
    if (walk.edgeKeys.has(key)) continue
    walk.edgeKeys.add(key)
    walk.edges.push({ from: row.from_node, to: row.to_node, relation: row.relation, weight: row.weight, createdAt: row.created_at })
    const other = otherEnd(row, inFrontier)
    if (other === undefined || walk.nodes.has(other)) continue
    walk.nodes.add(other)
    next.push(other)
  }
  return next
}

/** The edges within `maxDepth` steps of the start nodes, breadth first, at most `limit`. */
export function traverseGraph(db: DatabaseSync, starts: readonly string[], maxDepth: number, limit: number): GraphEdge[] {
  const walk: Walk = { nodes: new Set(starts), edgeKeys: new Set(), edges: [], limit }
  let frontier = [...walk.nodes]
  for (let depth = 0; depth < maxDepth && frontier.length > 0 && walk.edges.length < limit; depth++) {
    frontier = step(db, frontier, walk)
  }
  return walk.edges
}

const NODE_NAME = /^(mem|file|dir|symbol|command|agent):/
const BARE_ID = /^[A-Za-z0-9_]+$/

const SYMBOLS_OF_FILE = 'SELECT DISTINCT to_node AS node FROM edges WHERE to_node >= ? AND to_node < ?'

/** A query read as a path: the file, the directory and every symbol node of it. */
function pathNodes(op: Op, query: string): string[] {
  const [path] = op.root === undefined ? [] : relativePaths(op.root, [query])
  if (path === undefined) return []
  const symbols = sql(op.store.db, SYMBOLS_OF_FILE).all(`symbol:${path}#`, `symbol:${path}$`) as Array<{ node: string }>
  return [`file:${path}`, `dir:${path}`, ...symbols.map(row => row.node)]
}

/** A node name, a memory id, a path, and the memories a search finds, with the nodes their anchors name. */
function startNodes(op: Op, query: string, visibility: Visibility): Set<string> {
  const trimmed = query.trim()
  const starts = new Set<string>(pathNodes(op, trimmed))
  if (NODE_NAME.test(trimmed)) starts.add(slashes(trimmed))
  else if (BARE_ID.test(trimmed)) starts.add(memoryNode(trimmed))
  const ids = [...starts].filter(node => node.startsWith('mem:')).map(node => node.slice(4))
  const named = memoriesAmong(op, ids, { ...visibility, statuses: STATUSES, policies: EVERY_POLICY }, ids.length)
  for (const memory of [...named, ...searchStore(op.store.db, trimmed, visibility, 20)]) {
    starts.add(memoryNode(memory.id))
    for (const anchor of memory.anchors) {
      const node = anchorNode(anchor)
      if (node !== undefined) starts.add(node)
    }
  }
  return starts
}

/** The graph around a query: a memory id, a node name, a path, or search text. */
export function graphFor(op: Op, query: string, visibility: Visibility, maxDepth: number, limit: number): GraphEdge[] {
  const starts = startNodes(op, query, visibility)
  return starts.size === 0 ? [] : traverseGraph(op.store.db, [...starts], maxDepth, limit)
}

function normalizedCommand(command: string): string {
  return command.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** A command's family: its first two words, so `pnpm test` and `pnpm test --watch` are kin. */
function commandFamily(command: string): string {
  return normalizedCommand(command).split(' ').slice(0, 2).join(' ')
}

function comparablePath(path: string | undefined): string {
  const trimmed = path?.trim() ?? ''
  if (trimmed === '') return ''
  const normalized = slashes(trimmed).toLowerCase().replace(/^\.\/+/, '')
  return normalized === '' ? '.' : normalized
}

function symbolScore(left: Anchor, right: Anchor): number {
  if (!left.symbol || !right.symbol || left.symbol.toLowerCase() !== right.symbol.toLowerCase()) return 0
  const path = comparablePath(left.path)
  return path !== '' && path === comparablePath(right.path) ? 12 : 8
}

function commandScore(left: Anchor, right: Anchor): number {
  if (!left.command || !right.command) return 0
  if (normalizedCommand(left.command) === normalizedCommand(right.command)) return 10
  return commandFamily(left.command) === commandFamily(right.command) ? 5 : 0
}

function roleScore(left: Anchor, right: Anchor): number {
  return left.role && right.role && left.role.toLowerCase() === right.role.toLowerCase() ? 12 : 0
}

function nests(outer: string, inner: string): boolean {
  return outer === '.' || inner.startsWith(`${outer}/`)
}

function pathScore(left: Anchor, right: Anchor): number {
  const a = comparablePath(left.path)
  const b = comparablePath(right.path)
  if (a === '' || b === '') return 0
  const onPackage = left.type === 'package' || right.type === 'package'
  if (a === b) return onPackage ? 10 : 8
  return nests(a, b) || nests(b, a) ? (onPackage ? 6 : 3) : 0
}

function anchorPairScore(left: Anchor, right: Anchor): number {
  return symbolScore(left, right) + commandScore(left, right) + roleScore(left, right) + pathScore(left, right)
}

function sharedTagScore(candidate: Memory, seed: Memory): number {
  return Math.min(4, candidate.tags.filter(tag => seed.tags.includes(tag)).length * 1.5)
}

const PERSISTENCE_BONUS: Record<Persistence, number> = { permanent: 2, long_lived: 1, short_lived: -1 }

const DURABLE_KINDS: ReadonlySet<Kind> = new Set<Kind>(['fact', 'decision', 'convention', 'warning', 'anti_pattern', 'workflow', 'bug_root_cause', 'file_note', 'symbol_note', 'command_note'])

/**
 * How strongly a candidate relates to the seeds: reached through the graph (8), shared tags, and
 * a shared symbol, command, role or path. A candidate with none of these scores 0; the others add
 * their own weight on top.
 */
export function relationshipScore(candidate: Memory, seeds: readonly Memory[], graphIds: ReadonlySet<string>): number {
  let relation = graphIds.has(candidate.id) ? 8 : 0
  for (const seed of seeds) {
    relation += sharedTagScore(candidate, seed)
    for (const left of candidate.anchors) for (const right of seed.anchors) relation += anchorPairScore(left, right)
  }
  if (relation <= 0) return 0
  const kindBonus = DURABLE_KINDS.has(candidate.kind) ? 1 : 0
  return relation + candidate.importance * 2 + candidate.confidence + candidate.freshness + PERSISTENCE_BONUS[candidate.persistence] + kindBonus
}

const ANCHOR_TARGETS = `SELECT DISTINCT to_node AS node FROM edges WHERE from_node IN (SELECT value FROM json_each(?)) AND relation GLOB 'about_*'`

const WITH_TAG = `
  SELECT m.id AS id, m.data AS data FROM memories m
  WHERE EXISTS (SELECT 1 FROM json_each(m.tags) t WHERE t.value = ?)
    AND m.status IN (SELECT value FROM json_each(?)) AND m.context_policy IN (SELECT value FROM json_each(?))
    AND (? IS NULL OR m.scope = ?) AND (? = 1 OR m.scope != 'session' OR m.owner_session_id = ?) AND (? = 1 OR m.audience IS NULL)
  ORDER BY m.importance DESC, m.updated_at DESC
  LIMIT ?`

const COMMAND_EDGES = `
  SELECT DISTINCT substr(from_node, 5) AS id, substr(to_node, 9) AS command FROM edges
  WHERE relation = 'about_command' AND from_node GLOB 'mem:*' AND to_node >= 'command:' AND to_node < 'command;'`

/** The nodes the seeds point at, and the directories above their anchored paths. */
function seedTargets(db: DatabaseSync, seeds: readonly Memory[]): string[] {
  const rows = sql(db, ANCHOR_TARGETS).all(JSON.stringify(seeds.map(seed => memoryNode(seed.id)))) as Array<{ node: string }>
  const targets = new Set(rows.map(row => row.node))
  for (const anchor of seeds.flatMap(seed => seed.anchors)) {
    const node = anchorNode(anchor)
    if (node !== undefined) targets.add(node)
    for (const level of anchor.path ? ancestorPaths(anchor.path).slice(1) : []) {
      targets.add(`file:${level}`)
      targets.add(`dir:${level}`)
    }
  }
  return [...targets]
}

/** The ids of memories sharing a command family with a seed. */
function commandKin(db: DatabaseSync, seeds: readonly Memory[]): string[] {
  const families = new Set(seeds.flatMap(seed => seed.anchors.flatMap(anchor => (anchor.command ? [commandFamily(anchor.command)] : []))))
  if (families.size === 0) return []
  const rows = sql(db, COMMAND_EDGES).all() as Array<{ id: string; command: string }>
  return rows.filter(row => families.has(commandFamily(row.command))).map(row => row.id)
}

/**
 * Every memory worth scoring against the seeds: the graph's, the ones sharing an anchored node
 * or a directory above it, the most important ones sharing a tag (at most `budget` a tag), and
 * the ones sharing a command family.
 */
function candidateIds(db: DatabaseSync, seeds: readonly Memory[], graphIds: ReadonlySet<string>, visibility: Visibility, budget: number): Set<string> {
  const ids = new Set(graphIds)
  for (const row of sql(db, ABOUT_NODES).all(JSON.stringify(seedTargets(db, seeds))) as Array<{ id: string }>) ids.add(row.id)
  for (const tag of new Set(seeds.flatMap(seed => seed.tags))) {
    for (const memory of selectMemories(db, WITH_TAG, tag, ...visibilityParams(visibility), budget)) ids.add(memory.id)
  }
  for (const id of commandKin(db, seeds)) ids.add(id)
  for (const seed of seeds) ids.delete(seed.id)
  return ids
}

export type RelatedOptions = { visibility: Visibility; limit: number; maxDepth: number }

/**
 * The visible memories related to the seeds, strongest relation first. The graph walk always
 * runs: a tag shared by many memories must not switch off the stronger graph signal.
 */
export function findRelated(op: Op, seedIds: readonly string[], options: RelatedOptions): Memory[] {
  const db = op.store.db
  const seeds = memoriesAmong(op, seedIds, { ...options.visibility, statuses: STATUSES, policies: EVERY_POLICY, audienceScoped: true }, seedIds.length)
  if (seeds.length === 0) return []
  const budget = Math.max(100, options.limit * 20)
  const graphIds = new Set<string>()
  for (const edge of traverseGraph(db, seeds.map(seed => memoryNode(seed.id)), options.maxDepth, budget)) {
    for (const node of [edge.from, edge.to]) if (node.startsWith('mem:')) graphIds.add(node.slice(4))
  }
  const ids = candidateIds(db, seeds, graphIds, options.visibility, budget)
  return memoriesAmong(op, ids, options.visibility, ids.size)
    .map(memory => ({ memory, score: relationshipScore(memory, seeds, graphIds) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance || b.memory.confidence - a.memory.confidence)
    .slice(0, options.limit)
    .map(item => item.memory)
}
