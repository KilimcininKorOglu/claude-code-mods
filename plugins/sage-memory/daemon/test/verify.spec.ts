import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { Anchor, AnchorVerification, Memory, VerifyDepth } from '../../hooks/shared/model.ts'
import { declaredName } from '../agents.ts'
import { readAudit } from '../rows.ts'
import { updateMemory } from '../update.ts'
import { writeVerifications, type Applied } from '../verdicts.ts'
import { containsSymbol, verifyMemories, type Checked } from '../verify.ts'
import { cleanUp, tempDir } from './support.ts'
import { world, type World } from './world.ts'

after(cleanUp)

const ENTRY = 'The app entry registers the router before the first request'

function scopeOf(w: World): { root: string; agentDirs: string[] } {
  return { root: w.root, agentDirs: [join(w.root, '.claude', 'agents'), join(dirname(w.root), 'agents')] }
}

async function anchored(w: World, anchors: Anchor[], text = ENTRY): Promise<Memory> {
  return (await w.remember({ text, anchors })).memory
}

/** Checks the memories at the depth given, and writes nothing. */
async function checks(w: World, ids: readonly string[], depth: VerifyDepth = 'git'): Promise<Checked[]> {
  return verifyMemories(scopeOf(w), ids.map(id => w.read(id)), depth, w.op().now)
}

/** The verdict of each anchor of one memory, checked at the depth given. */
async function verdicts(w: World, id: string, depth: VerifyDepth = 'git'): Promise<Array<[string, string]>> {
  const [check] = await checks(w, [id], depth)
  return (check?.result.anchors ?? []).map((anchor: AnchorVerification) => [anchor.status, anchor.reason])
}

/** Checks the memories and writes what the checks found. */
async function verifyAndWrite(w: World, ids: readonly string[]): Promise<Applied> {
  return writeVerifications(w.op(), await checks(w, ids))
}

describe('anchor checks', () => {
  test('a file anchor is verified while the file is there, and stale once it is gone', async () => {
    const w = world()
    const memory = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    assert.deepEqual(await verdicts(w, memory.id), [['verified', 'the anchor is current']])
    rmSync(join(w.root, 'src', 'app.ts'))
    assert.deepEqual(await verdicts(w, memory.id), [['stale', 'the anchored path no longer exists']])
    w.close()
  })

  test('the content hash and the symbol are read from the content depth up, and the existence depth leaves them unknown', async () => {
    const w = world()
    const hash = `sha256:${createHash('sha256').update(readFileSync(join(w.root, 'src', 'app.ts'))).digest('hex')}`
    const memory = await anchored(w, [
      { type: 'file', path: 'src/app.ts', contentHash: hash },
      { type: 'symbol', path: 'src/app.ts', symbol: 'main' },
    ])
    assert.deepEqual((await verdicts(w, memory.id, 'content')).map(([status]) => status), ['verified', 'verified'])
    const shallow = 'the file exists; its content is checked from the content depth up'
    assert.deepEqual(await verdicts(w, memory.id, 'existence'), [['unknown', shallow], ['unknown', shallow]])
    writeFileSync(join(w.root, 'src', 'app.ts'), 'export function start() {}\n')
    assert.deepEqual(await verdicts(w, memory.id, 'content'), [
      ['stale', 'the file content changed'],
      ['stale', 'the symbol "main" is no longer in the file'],
    ])
    w.close()
  })

  test('a symbol is found as a whole identifier, one that starts with $ too', () => {
    assert.equal(containsSymbol('export const $store = writable(0)', '$store'), true, 'SAGE\'s \\b found no boundary before $')
    assert.equal(containsSymbol('const user = getUser()', 'get'), false)
    assert.equal(containsSymbol('client.get(url)', 'get'), true)
    assert.equal(containsSymbol('the flag is get_value', 'get'), false)
  })

  test('a directory anchor needs a directory, and a file anchor a file', async () => {
    const w = world()
    const memory = await anchored(w, [
      { type: 'directory', path: 'src' },
      { type: 'package', path: 'src/app.ts' },
      { type: 'file', path: 'src' },
    ])
    assert.deepEqual(await verdicts(w, memory.id, 'existence'), [
      ['verified', 'the directory exists'],
      ['stale', 'the package anchor points to a non-directory'],
      ['stale', 'the file anchor points to a non-file'],
    ])
    w.close()
  })

  test('an anchor that leads out of the project through a link is stale', async () => {
    const w = world()
    const memory = await anchored(w, [{ type: 'file', path: 'src/linked.ts' }])
    const outside = join(tempDir(), 'outside.ts')
    writeFileSync(outside, 'export {}\n')
    symlinkSync(outside, join(w.root, 'src', 'linked.ts'))
    assert.deepEqual(await verdicts(w, memory.id), [['stale', 'the anchor resolves through a link outside the project root']])
    w.close()
  })

  test('the git depth compares the git blob, and the content depth leaves it unknown', async () => {
    const w = world()
    execFileSync('git', ['init', '-q'], { cwd: w.root })
    const blob = execFileSync('git', ['hash-object', 'src/app.ts'], { cwd: w.root, encoding: 'utf8' }).trim()
    const memory = await anchored(w, [{ type: 'git', path: 'src/app.ts', gitBlobHash: blob }])
    const [check] = await checks(w, [memory.id])
    assert.deepEqual(check?.result.anchors.map(anchor => [anchor.status, anchor.gitBlobHash]), [['verified', blob]])
    assert.deepEqual(await verdicts(w, memory.id, 'content'), [['unknown', 'the git blob is checked at the git depth']])
    writeFileSync(join(w.root, 'src', 'app.ts'), 'export function main() { return 1 }\n')
    assert.deepEqual(await verdicts(w, memory.id), [['stale', 'the git blob changed']])
    w.close()
  })

  test('a command anchor is looked up on PATH or at its path, past a wrapper, and never run', async () => {
    const w = world()
    const bin = tempDir()
    const marker = join(bin, 'ran')
    writeFileSync(join(bin, 'present'), `#!/bin/sh\necho ran > "${marker}"\n`, { mode: 0o755 })
    writeFileSync(join(bin, 'plain'), '#!/bin/sh\n', { mode: 0o644 })
    mkdirSync(join(w.root, 'scripts'))
    writeFileSync(join(w.root, 'scripts', 'run.sh'), `#!/bin/sh\necho ran > "${marker}"\n`, { mode: 0o755 })
    const commands = ['cd src', 'present --all', 'plain', 'missing-tool-xyz run', 'npx missing-tool-xyz', 'sudo -X missing-tool-xyz', 'env FOO=1 present', './scripts/run.sh', 'sudo -u www present']
    const memory = await anchored(w, commands.map(command => ({ type: 'command', command })))
    const saved = process.env.PATH
    process.env.PATH = `${bin}:${saved ?? ''}`
    try {
      assert.deepEqual(await verdicts(w, memory.id), [
        ['verified', '"cd" is a shell builtin'],
        ['verified', '"present" is available'],
        ['stale', '"plain" is not on PATH'],
        ['stale', '"missing-tool-xyz" is not on PATH'],
        ['unknown', '"missing-tool-xyz" is not installed, and npx installs it on demand'],
        ['unknown', '"missing-tool-xyz" follows a flag the probe does not know, so it may be that flag\'s value; it is not on PATH'],
        ['verified', '"present" is available'],
        ['verified', '"./scripts/run.sh" is available'],
        ['verified', '"present" is available'],
      ])
    } finally {
      process.env.PATH = saved
    }
    assert.equal(existsSync(marker), false, 'no command ran')
    w.close()
  })

  test('an agent anchor names a type Claude Code ships or one an agent file declares by its name', async () => {
    const w = world()
    mkdirSync(join(w.root, '.claude', 'agents', 'team'), { recursive: true })
    writeFileSync(join(w.root, '.claude', 'agents', 'team', 'review.md'), '---\nname: "Reviewer"\ndescription: Reviews diffs\n---\nYou review.\n')
    writeFileSync(join(w.root, '.claude', 'agents', 'draft.md'), '---\nname: drafter\n---\nNo description, so not loaded.\n')
    mkdirSync(join(dirname(w.root), 'agents'), { recursive: true })
    writeFileSync(join(dirname(w.root), 'agents', 'mine.md'), '---\nname: helper\ndescription: Helps\n---\n')
    const roles = ['Explore', 'reviewer', 'helper', 'drafter', 'review']
    const memory = await anchored(w, roles.map(role => ({ type: 'agent', role })))
    assert.deepEqual(await verdicts(w, memory.id), [
      ['verified', '"explore" is an agent type Claude Code ships'],
      ['verified', 'an agent file declares "reviewer"'],
      ['verified', 'an agent file declares "helper"'],
      ['stale', 'no agent file declares "drafter"'],
      ['stale', 'no agent file declares "review"'],
    ])
    assert.deepEqual((await verdicts(w, memory.id, 'existence'))[0], ['unknown', 'command and agent anchors are checked from the content depth up'])
    w.close()
  })

  test('an agent file declares the name its frontmatter gives, with a description', () => {
    assert.equal(declaredName("---\nname: 'Code-Reviewer'\ndescription: x\n---\n"), 'code-reviewer')
    assert.equal(declaredName('---\ndescription: x\n---\n'), undefined)
    assert.equal(declaredName('name: loose\ndescription: x\n'), undefined, 'no frontmatter')
  })
})

describe('writing what a check found', () => {
  test('a failed check makes an active memory stale for verification, and a passing one brings it back', async () => {
    const w = world()
    const memory = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    const file = join(w.root, 'src', 'app.ts')
    rmSync(file)
    assert.deepEqual(await verifyAndWrite(w, [memory.id]), { staled: [memory.id], reactivated: [], verified: 0 })
    const stale = w.read(memory.id)
    assert.deepEqual([stale.status, stale.staleReason, stale.revision], ['stale', 'verification', 2])
    writeFileSync(file, 'export function main() {}\n')
    assert.deepEqual(await verifyAndWrite(w, [memory.id]), { staled: [], reactivated: [memory.id], verified: 0 })
    const back = w.read(memory.id)
    assert.deepEqual([back.status, back.staleReason, back.freshness, back.revision], ['active', undefined, 1, 3])
    const actions = readAudit(w.project.db, 10).map(entry => [entry.action, (entry.detail as { reason?: string } | undefined)?.reason])
    assert.deepEqual(actions.slice(0, 2), [
      ['memory.reactivated', 'every anchor verified again'],
      ['memory.staled', 'the anchored path no longer exists'],
    ])
    w.close()
  })

  test('a passing check stamps the memory without moving its revision', async () => {
    const w = world()
    const memory = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    await w.run(op => updateMemory(op, { id: memory.id, patch: { freshness: 0.4 } }))
    const before = w.read(memory.id)
    assert.deepEqual(await verifyAndWrite(w, [memory.id]), { staled: [], reactivated: [], verified: 1 })
    const after = w.read(memory.id)
    assert.deepEqual([after.revision, after.updatedAt, after.freshness], [before.revision, before.updatedAt, 1])
    assert.ok(after.lastVerifiedAt !== undefined && after.lastVerifiedAt > before.updatedAt)
    w.close()
  })

  test('a memory a person made stale stays stale when its anchors pass', async () => {
    const w = world()
    const memory = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    await w.run(op => updateMemory(op, { id: memory.id, patch: { status: 'stale' } }))
    const before = w.read(memory.id)
    assert.deepEqual(await verifyAndWrite(w, [memory.id]), { staled: [], reactivated: [], verified: 0 })
    const after = w.read(memory.id)
    assert.deepEqual([after.status, after.staleReason, after.revision], ['stale', 'manual', before.revision])
    assert.notEqual(after.lastVerifiedAt, undefined)
    w.close()
  })

  test('a memory whose anchors changed after the check is left to the next check', async () => {
    const w = world()
    const memory = await anchored(w, [{ type: 'file', path: 'src/app.ts' }])
    rmSync(join(w.root, 'src', 'app.ts'))
    const found = await checks(w, [memory.id])
    await w.run(op => updateMemory(op, { id: memory.id, patch: { anchors: [{ type: 'directory', path: 'src' }] } }))
    assert.deepEqual(await writeVerifications(w.op(), found), { staled: [], reactivated: [], verified: 0 })
    assert.equal(w.read(memory.id).status, 'active')
    w.close()
  })
})
