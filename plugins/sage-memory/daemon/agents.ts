import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Verdict } from './commands.ts'
import { unlessMissingAsync } from './files.ts'
import { messageOf } from './log.ts'

/**
 * Whether the subagent type an agent anchor names still exists: a type Claude Code ships, or one
 * an agent file declares in the project's `.claude/agents` or the user's `agents` directory.
 */

/** The agent types Claude Code ships, lowercased as a role anchor stores them. */
const BUILT_IN = new Set(['general-purpose', 'explore', 'plan', 'statusline-setup', 'claude-code-guide', 'claude'])

const ROLE = /^[a-z0-9][a-z0-9._-]{0,95}$/

/** How deep the directories under an agents directory are read. */
const MAX_DEPTH = 8

/** The agent types the agent files declare, and the first directory that could not be read. */
export type AgentNames = { names: Set<string>; unreadable?: string }

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/**
 * The type an agent file declares: its frontmatter's `name`, lowercased. Claude Code loads a file
 * only with a `name` and a `description`, and reads the type from `name`, not from the file name.
 */
export function declaredName(text: string): string | undefined {
  const block = FRONTMATTER.exec(text)?.[1]
  if (block === undefined || !/^description:/m.test(block)) return undefined
  const raw = /^name:[ \t]*(.*?)[ \t]*$/m.exec(block)?.[1] ?? ''
  const name = raw.replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase()
  return name === '' ? undefined : name
}

async function namesIn(dir: string, depth: number, into: AgentNames): Promise<void> {
  let entries: Dirent[] | undefined
  try {
    entries = await unlessMissingAsync(() => readdir(dir, { withFileTypes: true }))
  } catch (err) {
    into.unreadable ??= `${dir}: ${messageOf(err)}`
    return
  }
  for (const entry of entries ?? []) {
    const path = join(dir, entry.name)
    if (entry.isDirectory() && depth < MAX_DEPTH) await namesIn(path, depth + 1, into)
    else if (entry.name.endsWith('.md') && !entry.isDirectory()) await addName(path, into)
  }
}

async function addName(path: string, into: AgentNames): Promise<void> {
  try {
    const name = declaredName((await unlessMissingAsync(() => readFile(path, 'utf8'))) ?? '')
    if (name !== undefined) into.names.add(name)
  } catch (err) {
    into.unreadable ??= `${path}: ${messageOf(err)}`
  }
}

/** The agent types the agent files under `dirs` declare; a directory that does not exist declares none. */
export async function agentNames(dirs: readonly string[]): Promise<AgentNames> {
  const found: AgentNames = { names: new Set() }
  for (const dir of dirs) await namesIn(dir, 0, found)
  return found
}

export function verifyAgent(agents: AgentNames, role: string | undefined): Verdict {
  const name = (role ?? '').trim().toLowerCase()
  if (!ROLE.test(name)) return { status: 'stale', reason: 'the agent anchor has no valid role' }
  if (BUILT_IN.has(name)) return { status: 'verified', reason: `"${name}" is an agent type Claude Code ships` }
  if (agents.names.has(name)) return { status: 'verified', reason: `an agent file declares "${name}"` }
  if (agents.unreadable !== undefined) return { status: 'unknown', reason: `no agent file read declares "${name}", and ${agents.unreadable}` }
  return { status: 'stale', reason: `no agent file declares "${name}"` }
}
