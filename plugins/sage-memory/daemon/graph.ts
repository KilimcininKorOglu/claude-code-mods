import { dirname } from 'node:path/posix'
import type { DatabaseSync } from 'node:sqlite'
import type { Anchor, Memory } from '../hooks/shared/model.ts'
import { ancestorPaths } from './paths.ts'
import { parseMemory, sql, writeMemory } from './rows.ts'

/**
 * The memory graph: `mem:<id>` nodes joined to the files, directories, symbols, commands and
 * agents their anchors name (`about_*`, weighted by the memory's confidence), to each other
 * (`supersedes`, `contradicts`), and paths joined to their parents (`related_to`, shared by every
 * memory). A repeated edge keeps the larger weight.
 */

export function memoryNode(id: string): string {
  return `mem:${id}`
}

function pathNode(prefix: string): (anchor: Anchor) => string | undefined {
  return anchor => (anchor.path ? `${prefix}:${anchor.path}` : undefined)
}

const NODE: Record<Anchor['type'], (anchor: Anchor) => string | undefined> = {
  file: pathNode('file'),
  test: pathNode('file'),
  git: pathNode('file'),
  directory: pathNode('dir'),
  package: pathNode('dir'),
  symbol: anchor => (anchor.path && anchor.symbol ? `symbol:${anchor.path}#${anchor.symbol}` : undefined),
  command: anchor => (anchor.command ? `command:${anchor.command}` : undefined),
  agent: anchor => (anchor.role ? `agent:${anchor.role}` : undefined),
}

/** The graph node an anchor names: a file, directory, symbol, command or agent. */
export function anchorNode(anchor: Anchor): string | undefined {
  return NODE[anchor.type](anchor)
}

const RELATION: Record<Anchor['type'], string> = {
  file: 'about_file',
  test: 'about_file',
  git: 'about_file',
  directory: 'about_directory',
  package: 'about_package',
  symbol: 'about_symbol',
  command: 'about_command',
  agent: 'about_agent',
}

export function anchorRelation(anchor: Anchor): string {
  return RELATION[anchor.type]
}

const INSERT_EDGE = `
  INSERT INTO edges (from_node, to_node, relation, weight, created_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (from_node, to_node, relation) DO UPDATE SET weight = MAX(weight, excluded.weight)`

type Removed = { to_node: string; relation: string; created_at: string }

/** Edges a memory asserts; each keeps the time it was first written when it is written again. */
type Edge = { to: string; relation: string; weight: number }

/** Replaces the `from` node's edges of the relations `pattern` matches (a GLOB) with `edges`. */
function replaceEdges(db: DatabaseSync, from: string, pattern: string, edges: readonly Edge[], now: string): void {
  const removed = sql(db, 'DELETE FROM edges WHERE from_node = ? AND relation GLOB ? RETURNING to_node, relation, created_at').all(from, pattern) as Removed[]
  const firstWritten = new Map(removed.map(edge => [`${edge.to_node}\0${edge.relation}`, edge.created_at]))
  for (const edge of edges) {
    sql(db, INSERT_EDGE).run(from, edge.to, edge.relation, edge.weight, firstWritten.get(`${edge.to}\0${edge.relation}`) ?? now)
  }
}

/** The shared `related_to` edges from an anchored path up to the project root. */
function structureEdges(db: DatabaseSync, anchor: Anchor, weight: number, now: string): void {
  if (!anchor.path) return
  const isDirectory = anchor.type === 'directory' || anchor.type === 'package'
  const file = `file:${anchor.path}`
  const directory = isDirectory ? anchor.path : dirname(anchor.path)
  if (anchor.type === 'symbol' && anchor.symbol) sql(db, INSERT_EDGE).run(`symbol:${anchor.path}#${anchor.symbol}`, file, 'related_to', weight, now)
  if (!isDirectory) sql(db, INSERT_EDGE).run(file, `dir:${directory}`, 'related_to', weight, now)
  const chain = ancestorPaths(directory)
  for (let i = 0; i < chain.length - 1; i++) sql(db, INSERT_EDGE).run(`dir:${chain[i]}`, `dir:${chain[i + 1]}`, 'related_to', weight, now)
}

/** The most relationship edges one memory writes, so a huge list cannot run away inside a write. */
const MAX_RELATIONSHIP_EDGES = 256

function relationshipEdges(memory: Memory): Edge[] {
  const pairs = [
    ...(memory.supersedes ?? []).map(id => ({ relation: 'supersedes', id })),
    ...(memory.contradicts ?? []).map(id => ({ relation: 'contradicts', id })),
  ]
  const self = memoryNode(memory.id)
  const seen = new Set<string>()
  const edges: Edge[] = []
  for (const { relation, id } of pairs) {
    const to = memoryNode(id.trim())
    const key = `${to}\0${relation}`
    if (to === self || id.trim() === '' || seen.has(key)) continue
    seen.add(key)
    edges.push({ to, relation, weight: 1 })
    if (edges.length >= MAX_RELATIONSHIP_EDGES) break
  }
  return edges
}

/**
 * Rewrites a memory's own edges from its record: its `about_*` edges while it is active or stale,
 * and its `supersedes` and `contradicts` edges always, so an id taken out of either list loses its
 * edge.
 */
export function syncEdges(db: DatabaseSync, memory: Memory, now: string): void {
  const from = memoryNode(memory.id)
  const live = memory.status === 'active' || memory.status === 'stale'
  const anchors = live ? memory.anchors : []
  const about = anchors.flatMap(anchor => {
    const to = anchorNode(anchor)
    return to === undefined ? [] : [{ to, relation: anchorRelation(anchor), weight: memory.confidence }]
  })
  replaceEdges(db, from, 'about_*', about, now)
  anchors.forEach(anchor => structureEdges(db, anchor, memory.confidence, now))
  const relationships = relationshipEdges(memory)
  for (const relation of ['supersedes', 'contradicts']) {
    replaceEdges(db, from, relation, relationships.filter(edge => edge.relation === relation), now)
  }
}

/** The edges into or out of a memory, the shared `related_to` ones left out. */
export function edgeCount(db: DatabaseSync, id: string): number {
  const node = memoryNode(id)
  const row = sql(db, "SELECT COUNT(*) AS n FROM edges WHERE (from_node = ? OR to_node = ?) AND relation != 'related_to'").get(node, node) as { n: number }
  return row.n
}

/** Removes every edge into or out of a memory but the shared `related_to` ones. */
export function dropEdges(db: DatabaseSync, id: string): void {
  const node = memoryNode(id)
  sql(db, "DELETE FROM edges WHERE (from_node = ? OR to_node = ?) AND relation != 'related_to'").run(node, node)
}

const REFERRING = `
  SELECT id, data FROM memories
  WHERE id != ? AND status != 'deleted' AND (
    json_extract(data, '$.supersededBy') = ?
    OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(data, '$.supersedes'), '[]')) WHERE value = ?)
    OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(data, '$.contradicts'), '[]')) WHERE value = ?))`

/** Takes a deleted memory's id out of every live memory that names it. */
export function clearReferences(db: DatabaseSync, id: string, now: string): void {
  const rows = sql(db, REFERRING).all(id, id, id, id) as Array<{ id: string; data: string }>
  for (const other of rows.map(parseMemory)) {
    const next: Memory = {
      ...other,
      supersedes: other.supersedes?.filter(value => value !== id),
      contradicts: other.contradicts?.filter(value => value !== id),
      supersededBy: other.supersededBy === id ? undefined : other.supersededBy,
      revision: other.revision + 1,
      updatedAt: now,
    }
    writeMemory(db, next)
    syncEdges(db, next, now)
  }
}
