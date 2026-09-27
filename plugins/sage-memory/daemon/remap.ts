import { readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { Anchor, Memory, RemapMove } from '../hooks/shared/model.ts'
import { movesOf } from '../hooks/shared/moves.ts'
import { distinct } from './anchors.ts'
import { unlessMissingAsync } from './files.ts'
import { syncEdges } from './graph.ts'
import type { Op } from './op.ts'
import { isInside, projectPathIfInside } from './paths.ts'
import { audit, selectMemories, sql, writeMemory } from './rows.ts'
import { transaction } from './stores.ts'

/**
 * Anchors that follow the files a command moved. Each move the command names is checked on the
 * disk as the command left it: its source must be gone and its target there. The moves are checked
 * from the last to the first, each against the disk as the moves after it left it, so a move whose
 * target a later move of the same command took away (`mv a tmp && mv tmp b`) still counts. The
 * anchors of the active and stale memories at or under a moved path follow it, for at most 50
 * moves an hour per project, counted from the store's audit log so a daemon started again keeps
 * the limit.
 */

/** A move that happened: where its source was, and where the source is after it. */
export type Moved = { from: string; to: string }

/** A path at or under the source of a move, where the move put it. */
function carried(path: string, move: Moved): string {
  return move.to + path.slice(move.from.length)
}

/** Whether something is at `path` under exactly this name, also on a file system that ignores case. */
async function present(path: string): Promise<boolean> {
  const names = await unlessMissingAsync(() => readdir(dirname(path)))
  return names?.includes(basename(path)) ?? false
}

/**
 * Whether something was at `path` right after a move: where the later moves carried it must hold
 * something now. A later move that put something else at `path` found it free, so nothing was there.
 */
async function wasThere(path: string, later: readonly Moved[]): Promise<boolean> {
  let at = path
  for (const move of later) {
    if (isInside(move.from, at)) at = carried(at, move)
    else if (isInside(move.to, at)) return false
  }
  return present(at)
}

/**
 * Where a move put its source: into its target when the target is a directory, else at the target
 * itself; undefined when the move did not happen. A directory renamed to a new name that holds an
 * entry of its own name reads as moved into the target, since the disk after the move cannot tell
 * the two apart.
 */
async function landing(move: Moved, later: readonly Moved[]): Promise<string | undefined> {
  if (await wasThere(move.from, later)) return undefined
  const into = join(move.to, basename(move.from))
  if (await wasThere(into, later)) return into
  return (await wasThere(move.to, later)) ? move.to : undefined
}

/** The moves a command made, first to last, as absolute paths read from the directory it started in. */
export async function movesMade(command: string, cwd: string): Promise<Moved[]> {
  const named = movesOf(command).map(move => ({ from: resolve(cwd, ...move.dirs, move.from), to: resolve(cwd, ...move.dirs, move.to) }))
  const made: Moved[] = []
  for (const move of named.reverse()) {
    const to = await landing(move, made)
    if (to !== undefined) made.unshift({ from: move.from, to })
  }
  return made
}

/** The most moves an hour that take anchors with them, per project. */
const MOVES_PER_HOUR = 50

const HOUR_MS = 3_600_000

const MOVED_SINCE = "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'memory.remapped' AND at >= ?"

/** The active and stale memories with an anchor at or under one of the paths of a JSON array. */
const ANCHORED_UNDER = `
  SELECT id, data FROM memories
  WHERE status IN ('active', 'stale') AND EXISTS (
    SELECT 1 FROM json_each(data, '$.anchors') AS anchor, json_each(?) AS base
    WHERE json_extract(anchor.value, '$.path') = base.value
      OR substr(json_extract(anchor.value, '$.path'), 1, length(base.value) + 1) = base.value || '/')
  ORDER BY id`

/** A move as paths relative to the project root; undefined when an end lies outside the project, or the root itself moved. */
function inProject(root: string, move: Moved): Moved | undefined {
  const from = projectPathIfInside(root, move.from)
  const to = projectPathIfInside(root, move.to)
  return from === undefined || to === undefined || from === '.' ? undefined : { from, to }
}

type Pass = { memories: Map<string, Memory>; budget: number; moves: RemapMove[]; limited: number }

function holds(memory: Memory, path: string): boolean {
  return memory.anchors.some(anchor => anchor.path !== undefined && isInside(path, anchor.path))
}

function follow(anchor: Anchor, move: Moved): Anchor {
  return anchor.path !== undefined && isInside(move.from, anchor.path) ? { ...anchor, path: carried(anchor.path, move) } : anchor
}

/** Carries the anchors at or under a move's source to its target, while the hour's limit lasts. */
function applyMove(pass: Pass, move: Moved): void {
  const hit = [...pass.memories.values()].filter(memory => holds(memory, move.from))
  if (hit.length === 0) return
  if (pass.budget === 0) {
    pass.limited++
    return
  }
  pass.budget--
  for (const memory of hit) pass.memories.set(memory.id, { ...memory, anchors: memory.anchors.map(anchor => follow(anchor, move)) })
  pass.moves.push({ from: move.from, to: move.to, memories: hit.map(memory => memory.id) })
}

/** Writes each memory whose anchors moved once, with its revision moved on and its edges rewritten, and one audit row per move. */
function writeMoved(op: Op, pass: Pass): Memory[] {
  const moved = new Set(pass.moves.flatMap(move => move.memories))
  const written = [...pass.memories.values()]
    .filter(memory => moved.has(memory.id))
    .map(memory => ({ ...memory, anchors: distinct(memory.anchors), revision: memory.revision + 1, updatedAt: op.now }))
  for (const memory of written) {
    writeMemory(op.store.db, memory)
    syncEdges(op.store.db, memory, op.now)
  }
  for (const move of pass.moves) audit(op.store, op.now, 'memory.remapped', { detail: move })
  return written
}

export type Remapped = { moves: RemapMove[]; limited: number; memories: Memory[] }

/**
 * Carries the anchors of the project's active and stale memories through the moves, in order, and
 * answers the moves that took anchors with them and the memories written.
 */
export function remapAnchors(op: Op, root: string, made: readonly Moved[]): Promise<Remapped> {
  return transaction(op.store, () => {
    const moves = made.flatMap(move => inProject(root, move) ?? [])
    const since = new Date(Date.parse(op.now) - HOUR_MS).toISOString()
    const used = (sql(op.store.db, MOVED_SINCE).get(since) as { n: number }).n
    const found = selectMemories(op.store.db, ANCHORED_UNDER, JSON.stringify(moves.map(move => move.from)))
    const pass: Pass = { memories: new Map(found.map(memory => [memory.id, memory])), budget: Math.max(0, MOVES_PER_HOUR - used), moves: [], limited: 0 }
    moves.forEach(move => applyMove(pass, move))
    return { moves: pass.moves, limited: pass.limited, memories: writeMoved(op, pass) }
  })
}
