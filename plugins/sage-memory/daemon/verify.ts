import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Anchor, AnchorVerification, Memory, MemoryVerification, Status, VerificationStatus, VerifyDepth } from '../hooks/shared/model.ts'
import { agentNames, verifyAgent, type AgentNames } from './agents.ts'
import { gitBlobs, type Blobs } from './blobs.ts'
import { verifyCommand, type Verdict } from './commands.ts'
import { unlessMissingAsync } from './files.ts'
import { messageOf } from './log.ts'
import { isInside } from './paths.ts'

/**
 * Checking a memory's anchors against the project as it is now. Each anchor is `verified`, `stale`
 * or `unknown`; a memory is stale when one anchor is, and verified when every one is. Ported from
 * SAGE's `verifyMemoryAnchors`, with the depth applied: a check the depth skips answers `unknown`,
 * so a shallow check never passes what a deeper one would fail.
 */

/** Where a store's anchors are read from: the project root (none for the global store) and the agent directories. */
export type VerifyScope = { root: string | undefined; agentDirs: readonly string[] }

/** One memory's check, with the status and anchors the check saw. */
export type Checked = { result: MemoryVerification; status: Status; anchors: readonly Anchor[] }

type Context = { root: string | undefined; realRoot: string | undefined; depth: VerifyDepth; agents: AgentNames; blobs: Blobs }

const DIRECTORY_TYPES: ReadonlySet<string> = new Set(['directory', 'package'])

const verified = (reason: string): Verdict => ({ status: 'verified', reason })
const stale = (reason: string): Verdict => ({ status: 'stale', reason })
const unknown = (reason: string): Verdict => ({ status: 'unknown', reason })

/** Whether the check needs the file's git blob: the anchor records one, or is a git anchor. */
function wantsBlob(anchor: Anchor): boolean {
  return anchor.gitBlobHash !== undefined || anchor.type === 'git'
}

/**
 * Whether `symbol` stands in the text as a whole identifier. The boundary is SAGE's remap one:
 * `\b` finds no boundary before a symbol that starts with `$`, so `$store` was never found.
 */
export function containsSymbol(text: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, 'u').test(text)
}

export function aggregate(anchors: readonly AnchorVerification[]): VerificationStatus {
  if (anchors.length === 0) return 'unknown'
  if (anchors.some(anchor => anchor.status === 'stale')) return 'stale'
  return anchors.every(anchor => anchor.status === 'verified') ? 'verified' : 'unknown'
}

function blobPaths(root: string, anchors: readonly Anchor[]): string[] {
  return anchors.flatMap(anchor => {
    if (!wantsBlob(anchor) || anchor.path === undefined) return []
    const absolute = resolve(root, anchor.path)
    return isInside(root, absolute) ? [absolute] : []
  })
}

async function blobsFor(scope: VerifyScope, realRoot: string | undefined, anchors: readonly Anchor[], depth: VerifyDepth): Promise<Blobs> {
  if (depth !== 'git' || scope.root === undefined || realRoot === undefined) return { hashes: new Map() }
  return gitBlobs(scope.root, realRoot, blobPaths(scope.root, anchors))
}

async function agentsFor(scope: VerifyScope, anchors: readonly Anchor[], depth: VerifyDepth): Promise<AgentNames> {
  if (depth === 'existence' || !anchors.some(anchor => anchor.type === 'agent')) return { names: new Set() }
  return agentNames(scope.agentDirs)
}

async function contextFor(scope: VerifyScope, memories: readonly Memory[], depth: VerifyDepth): Promise<Context> {
  const root = scope.root
  const realRoot = root === undefined ? undefined : ((await unlessMissingAsync(() => realpath(root))) ?? resolve(root))
  const anchors = memories.flatMap(memory => memory.anchors)
  return { root, realRoot, depth, agents: await agentsFor(scope, anchors, depth), blobs: await blobsFor(scope, realRoot, anchors, depth) }
}

/** A command or agent anchor: whether what it names is still there. */
async function targetVerdict(context: Context, anchor: Anchor): Promise<Verdict> {
  if (context.depth === 'existence') return unknown('command and agent anchors are checked from the content depth up')
  if (anchor.type === 'agent') return verifyAgent(context.agents, anchor.role)
  return verifyCommand(context.root, anchor.command ?? '')
}

type Found = { absolute: string; real: string; info: Stats }

/** Where a path anchor leads inside the project, or the verdict that it leads nowhere there. */
async function located(context: Context, anchor: Anchor): Promise<{ verdict: Verdict } | Found> {
  if (anchor.path === undefined) return { verdict: unknown('the anchor has no path') }
  if (context.root === undefined || context.realRoot === undefined) return { verdict: unknown('a path anchor needs the project root') }
  const absolute = resolve(context.root, anchor.path)
  if (!isInside(context.root, absolute)) return { verdict: stale('the anchor resolves outside the project root') }
  const real = await unlessMissingAsync(() => realpath(absolute))
  if (real === undefined) return { verdict: stale('the anchored path no longer exists') }
  if (!isInside(context.realRoot, real)) return { verdict: stale('the anchor resolves through a link outside the project root') }
  return { absolute, real, info: await stat(real) }
}

function directoryVerdict(anchor: Anchor, info: Stats): Verdict {
  const what = anchor.type === 'package' ? 'package directory' : 'directory'
  return info.isDirectory() ? verified(`the ${what} exists`) : stale(`the ${anchor.type} anchor points to a non-directory`)
}

/** The existence depth reads no content: an anchor that records content, a symbol or a blob passes no further than `unknown`. */
function existenceVerdict(anchor: Anchor): Verdict {
  const deeper = anchor.contentHash !== undefined || anchor.symbol !== undefined || wantsBlob(anchor)
  return deeper ? unknown('the file exists; its content is checked from the content depth up') : verified('the file exists')
}

/** A stale verdict for a changed content hash or a symbol gone from the file; undefined while both hold. */
function contentVerdict(anchor: Anchor, body: Buffer, contentHash: string): Verdict | undefined {
  if (anchor.contentHash !== undefined && anchor.contentHash !== contentHash) return stale('the file content changed')
  if (anchor.symbol !== undefined && !containsSymbol(body.toString('utf8'), anchor.symbol)) return stale(`the symbol "${anchor.symbol}" is no longer in the file`)
  return undefined
}

function blobVerdict(context: Context, anchor: Anchor, absolute: string): Verdict & { gitBlobHash?: string } {
  if (!wantsBlob(anchor)) return verified('the anchor is current')
  if (context.depth !== 'git') return unknown('the git blob is checked at the git depth')
  const gitBlobHash = context.blobs.hashes.get(absolute)
  if (gitBlobHash === undefined) return unknown(`git could not hash the file${context.blobs.error === undefined ? '' : `: ${context.blobs.error}`}`)
  if (anchor.gitBlobHash !== undefined && anchor.gitBlobHash !== gitBlobHash) return { ...stale('the git blob changed'), gitBlobHash }
  return { ...verified('the anchor is current'), gitBlobHash }
}

async function contentVerification(context: Context, anchor: Anchor, found: Found): Promise<AnchorVerification> {
  const body = await readFile(found.real)
  const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`
  return { anchor, contentHash, ...(contentVerdict(anchor, body, contentHash) ?? blobVerdict(context, anchor, found.absolute)) }
}

async function pathVerification(context: Context, anchor: Anchor): Promise<AnchorVerification> {
  const found = await located(context, anchor)
  if ('verdict' in found) return { anchor, ...found.verdict }
  if (DIRECTORY_TYPES.has(anchor.type)) return { anchor, ...directoryVerdict(anchor, found.info) }
  if (!found.info.isFile()) return { anchor, ...stale(`the ${anchor.type} anchor points to a non-file`) }
  if (context.depth === 'existence') return { anchor, ...existenceVerdict(anchor) }
  return contentVerification(context, anchor, found)
}

/** One anchor's check; a check that throws answers `unknown` with the error it met. */
async function verifyAnchor(context: Context, anchor: Anchor): Promise<AnchorVerification> {
  try {
    if (anchor.type === 'command' || anchor.type === 'agent') return { anchor, ...(await targetVerdict(context, anchor)) }
    return await pathVerification(context, anchor)
  } catch (err) {
    return { anchor, ...unknown(`the check failed: ${messageOf(err)}`) }
  }
}

/** Checks each memory's anchors at the depth given, one memory after another. */
export async function verifyMemories(scope: VerifyScope, memories: readonly Memory[], depth: VerifyDepth, checkedAt: string): Promise<Checked[]> {
  const context = await contextFor(scope, memories, depth)
  const checks: Checked[] = []
  for (const memory of memories) {
    const anchors: AnchorVerification[] = []
    for (const anchor of memory.anchors) anchors.push(await verifyAnchor(context, anchor))
    checks.push({ result: { memoryId: memory.id, status: aggregate(anchors), checkedAt, anchors }, status: memory.status, anchors: memory.anchors })
  }
  return checks
}
