import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { Anchor, Memory } from '../../hooks/shared/model.ts'
import { syncEdges } from '../graph.ts'
import { movesMade, remapAnchors, type Remapped } from '../remap.ts'
import { audit, readAudit, writeMemory } from '../rows.ts'
import { cleanUp, tempDir } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const ENTRY = 'The app entry registers the router before the first request'

/** Reads what a command moved on the disk as it stands, from `cwd`, and carries the anchors. */
async function remapAfter(w: World, command: string, cwd = w.root): Promise<Remapped> {
  const made = await movesMade(command, cwd)
  return remapAnchors(w.op(), w.root, made)
}

function move(w: World, from: string, to: string): void {
  renameSync(join(w.root, from), join(w.root, to))
}

function paths(w: World, id: string): Array<string | undefined> {
  return w.read(id).anchors.map(anchor => anchor.path)
}

async function anchored(w: World, anchors: Anchor[], text = ENTRY): Promise<Memory> {
  return (await w.remember({ text, anchors })).memory
}

function git(w: World, ...args: string[]): void {
  execFileSync('git', args, { cwd: w.root, stdio: 'pipe' })
}

/** Writes a memory as it is given, edges and all, as a person's or a review's change would. */
async function rewrite(w: World, memory: Memory): Promise<void> {
  await w.run(op => {
    writeMemory(op.store.db, memory)
    syncEdges(op.store.db, memory, op.now)
  })
}

describe('carrying anchors after a command moved files', () => {
  test('a git mv carries the file and symbol anchors, their edges and one audit row, and moves the revision on once', async () => {
    const w = world()
    writeFileSync(join(w.root, 'src', 'util.ts'), 'export const day = 86400\n')
    const entry = await anchored(w, [{ type: 'file', path: 'src/app.ts' }, { type: 'symbol', path: 'src/app.ts', symbol: 'main' }])
    const util = await anchored(w, [{ type: 'file', path: 'src/util.ts' }], 'The utility module keeps the date helpers in one place')
    git(w, 'init', '-q')
    git(w, 'add', '-A')
    git(w, 'mv', 'src/app.ts', 'src/main.ts')
    const report = await remapAfter(w, 'git mv src/app.ts src/main.ts')
    assert.deepEqual([report.moves, report.limited], [[{ from: 'src/app.ts', to: 'src/main.ts', memories: [entry.id] }], 0])
    assert.deepEqual(paths(w, entry.id), ['src/main.ts', 'src/main.ts'])
    assert.deepEqual([w.read(entry.id).revision, w.read(util.id).revision], [entry.revision + 1, util.revision])
    assert.deepEqual(
      w.edges().filter(edge => edge.startsWith(`mem:${entry.id} about_`)),
      [`mem:${entry.id} about_file file:src/main.ts`, `mem:${entry.id} about_symbol symbol:src/main.ts#main`],
    )
    const [row] = readAudit(w.project.db, 1)
    assert.deepEqual([row?.action, row?.detail], ['memory.remapped', { from: 'src/app.ts', to: 'src/main.ts', memories: [entry.id] }])
    w.close()
  })

  test('a file moved into a directory lands inside it, and a moved directory carries every anchor under it', async () => {
    const w = world()
    const file = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    const folder = await anchored(w, [{ type: 'directory', path: 'src' }], 'The source folder holds the application code alone')
    mkdirSync(join(w.root, 'lib'))
    move(w, 'src/app.ts', 'lib/app.ts')
    await remapAfter(w, 'mv src/app.ts lib')
    assert.deepEqual([paths(w, file.id), paths(w, folder.id)], [['lib/app.ts'], ['src']], 'the directory anchor is not under the moved file')
    move(w, 'lib', 'pkg')
    await remapAfter(w, 'mv lib pkg')
    move(w, 'src', 'pkg/src')
    await remapAfter(w, 'mv src pkg/')
    assert.deepEqual([paths(w, file.id), paths(w, folder.id)], [['pkg/app.ts'], ['pkg/src']])
    w.close()
  })

  test('a move through a temporary name in one command counts, and so does a rename that changes case alone', async () => {
    const w = world()
    const entry = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    move(w, 'src/app.ts', 'tmp.ts')
    move(w, 'tmp.ts', 'src/entry.ts')
    const report = await remapAfter(w, 'mv src/app.ts tmp.ts && mv tmp.ts src/entry.ts')
    assert.deepEqual(
      report.moves.map(item => [item.from, item.to]),
      [['src/app.ts', 'tmp.ts'], ['tmp.ts', 'src/entry.ts']],
      'the target of the first move was gone once the command ended',
    )
    assert.deepEqual([paths(w, entry.id), w.read(entry.id).revision], [['src/entry.ts'], entry.revision + 1])
    move(w, 'src/entry.ts', 'src/Entry.ts')
    await remapAfter(w, 'mv src/entry.ts src/Entry.ts')
    assert.deepEqual(paths(w, entry.id), ['src/Entry.ts'], 'a file system that ignores case still finds the old name')
    w.close()
  })

  test('the paths are read from the directory the command started in, after the cd before the move', async () => {
    const w = world()
    const entry = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    move(w, 'src/app.ts', 'src/main.ts')
    await remapAfter(w, 'mv app.ts main.ts', join(w.root, 'src'))
    assert.deepEqual(paths(w, entry.id), ['src/main.ts'])
    move(w, 'src/main.ts', 'src/app.ts')
    await remapAfter(w, 'cd src && mv main.ts app.ts')
    assert.deepEqual(paths(w, entry.id), ['src/app.ts'])
    w.close()
  })

  test('a move that did not happen carries nothing: a command that failed, or a dry run', async () => {
    const w = world()
    const entry = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    assert.deepEqual(await remapAfter(w, 'mv src/app.ts src/main.ts'), { moves: [], limited: 0, memories: [] }, 'the source is still there')
    git(w, 'init', '-q')
    git(w, 'add', '-A')
    git(w, 'mv', '-n', 'src/app.ts', 'src/main.ts')
    assert.deepEqual((await remapAfter(w, 'git mv -n src/app.ts src/main.ts')).moves, [])
    assert.deepEqual([paths(w, entry.id), w.read(entry.id).revision], [['src/app.ts'], entry.revision])
    assert.equal(readAudit(w.project.db, 10).some(row => row.action === 'memory.remapped'), false)
    w.close()
  })

  test('a move out of the project leaves the anchor where it was', async () => {
    const w = world()
    const entry = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    const outside = tempDir()
    renameSync(join(w.root, 'src', 'app.ts'), join(outside, 'app.ts'))
    assert.deepEqual((await remapAfter(w, `mv src/app.ts ${outside}/app.ts`)).moves, [])
    assert.deepEqual(paths(w, entry.id), ['src/app.ts'])
    w.close()
  })

  test('the anchors of active and stale memories follow the file, and those of an archived one stay', async () => {
    const w = world()
    const active = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    const stale = await anchored(w, [{ type: 'file', path: 'src/app.ts' }], 'The entry file once loaded the settings before the router')
    const archived = await anchored(w, [{ type: 'file', path: 'src/app.ts' }], 'An early draft kept the whole server in the entry file')
    await rewrite(w, { ...stale, status: 'stale', staleReason: 'manual' })
    await rewrite(w, { ...archived, status: 'archived' })
    move(w, 'src/app.ts', 'src/main.ts')
    const report = await remapAfter(w, 'mv src/app.ts src/main.ts')
    assert.deepEqual([...(report.moves[0]?.memories ?? [])].sort(), [active.id, stale.id].sort())
    assert.deepEqual([paths(w, active.id), paths(w, stale.id), paths(w, archived.id)], [['src/main.ts'], ['src/main.ts'], ['src/app.ts']])
    assert.deepEqual([w.read(stale.id).status, w.read(stale.id).staleReason], ['stale', 'manual'], 'a remap decides no status')
    w.close()
  })

  test('at most 50 moves an hour carry anchors, counted from the audit log, and the same move counts each time it is made', async () => {
    const w = world()
    const entry = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    writeFileSync(join(w.root, 'src', 'other.ts'), 'export {}\n')
    await w.run(op => {
      const nowMs = Date.parse(op.now)
      for (let i = 0; i < 47; i++) audit(op.store, new Date(nowMs - 30 * 60_000).toISOString(), 'memory.remapped', { detail: { from: 'x', to: 'y', memories: [] } })
      for (let i = 0; i < 5; i++) audit(op.store, new Date(nowMs - 2 * 3_600_000).toISOString(), 'memory.remapped', { detail: { from: 'x', to: 'y', memories: [] } })
    })
    for (const [from, to] of [['src/app.ts', 'src/b.ts'], ['src/b.ts', 'src/app.ts']]) {
      move(w, from as string, to as string)
      assert.equal((await remapAfter(w, `mv ${from} ${to}`)).moves.length, 1, `${from} to ${to}`)
    }
    move(w, 'src/other.ts', 'src/other2.ts')
    assert.deepEqual(await remapAfter(w, 'mv src/other.ts src/other2.ts'), { moves: [], limited: 0, memories: [] }, 'a move that carries no anchor is not counted')
    move(w, 'src/app.ts', 'src/b.ts')
    assert.equal((await remapAfter(w, 'mv src/app.ts src/b.ts')).moves.length, 1, 'the 50th move of the hour')
    move(w, 'src/b.ts', 'src/c.ts')
    const held = await remapAfter(w, 'mv src/b.ts src/c.ts')
    assert.deepEqual([held.moves, held.limited], [[], 1])
    assert.deepEqual(paths(w, entry.id), ['src/b.ts'])
    w.close()
  })
})
