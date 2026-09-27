import { stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { codeOf } from './log.ts'

/**
 * Whether the command a command anchor names is still there: the executable its first word names
 * (past a wrapper such as `sudo` or `npx`) is looked up on PATH, or at the path it gives. The
 * command is never run. Ported from SAGE's anchor verification.
 */

export type Verdict = { status: 'verified' | 'stale' | 'unknown'; reason: string }

/** Wrappers that run the command after them, so the probe looks up that command. */
const WRAPPERS = new Set(['sudo', 'npx', 'env', 'time', 'command', 'doas', 'runuser'])

/**
 * The flags of each wrapper that take the next word as their value, so `sudo -u www node` finds
 * `node`. A flag not listed is skipped alone, and a command then not found is `unknown`, since that
 * flag may have taken the word the probe read as the command.
 */
const VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  npx: new Set(['-p', '--package', '--registry', '--cache', '--userconfig', '--globalconfig', '--prefix', '--cwd', '--shell']),
  sudo: new Set(['-u', '-g', '-p', '-C', '-R', '-D', '-T', '--user', '--group', '--prompt', '--chdir', '--command-timeout']),
  env: new Set(['-u', '-C', '--unset', '--chdir']),
  doas: new Set(['-u']),
  runuser: new Set(['-u', '-g']),
}

/** Wrappers that install the command they run on demand, so a command not installed is no sign of staleness. */
const INSTALLS_ON_DEMAND = new Set(['npx'])

/** Shell builtins and keywords: the shell provides them, so no PATH entry names them. */
const BUILTINS = new Set(['cd', 'echo', 'type', 'alias', 'exit', 'set', 'unset', 'printf', 'pwd', 'export', 'test', 'true', 'false', 'read', 'shift', 'source', '.'])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** How many words of a command the probe reads: the command, a wrapper and its flags. */
const MAX_WORDS = 10

type Word = { text: string; raw: string }

/** The first word of `input`: a quoted run without its quotes, or a run of non-space characters. */
function firstWord(input: string): Word | undefined {
  const match = /^"([^"]+)"|^'([^']+)'|^(\S+)/.exec(input)
  const text = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
  return match && text ? { text, raw: match[0] } : undefined
}

function wordsOf(command: string): string[] {
  const words: string[] = []
  let rest = command.trim()
  while (words.length < MAX_WORDS) {
    const word = firstWord(rest)
    if (!word) break
    words.push(word.text)
    rest = rest.slice(word.raw.length).trim()
  }
  return words
}

/** The executable a command runs, and what the probe skipped on its way there. */
export type Resolved = { executable?: string; skippedFlag: boolean; installsOnDemand: boolean; wrapper?: string }

function afterWrapper(wrapper: string, words: readonly string[]): Resolved {
  const valueFlags = VALUE_FLAGS[wrapper] ?? new Set<string>()
  const resolved: Resolved = { skippedFlag: false, installsOnDemand: INSTALLS_ON_DEMAND.has(wrapper), wrapper }
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? ''
    if (ASSIGNMENT.test(word)) continue
    if (!word.startsWith('-')) return { ...resolved, executable: word }
    if (valueFlags.has(word)) i++
    else resolved.skippedFlag = true
  }
  return resolved
}

export function resolveExecutable(command: string): Resolved {
  const [first, ...rest] = wordsOf(command)
  if (first === undefined) return { skippedFlag: false, installsOnDemand: false }
  if (!WRAPPERS.has(first)) return { executable: first, skippedFlag: false, installsOnDemand: false }
  return afterWrapper(first, rest)
}

/** The codes that mean a candidate cannot be run from where the probe looked. */
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP', 'ENAMETOOLONG'])

/** Whether `path` is a file with an execute bit. */
async function isExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch (err) {
    if (NOT_THERE.has(codeOf(err) ?? '')) return false
    throw err
  }
}

async function onPath(executable: string): Promise<boolean> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir !== '' && (await isExecutable(join(dir, executable)))) return true
  }
  return false
}

/**
 * Whether the executable is on PATH, or at the path it gives (a relative one read from the project
 * root); undefined for a relative path in a store with no project root.
 */
async function executableExists(root: string | undefined, executable: string): Promise<boolean | undefined> {
  if (!executable.includes('/')) return onPath(executable)
  if (isAbsolute(executable)) return isExecutable(executable)
  return root === undefined ? undefined : isExecutable(resolve(root, executable))
}

/** Whether the command a command anchor names can still run here, without running it. */
export async function verifyCommand(root: string | undefined, command: string): Promise<Verdict> {
  const resolved = resolveExecutable(command)
  const executable = resolved.executable
  if (executable === undefined) return { status: 'stale', reason: 'the command anchor names no executable' }
  if (BUILTINS.has(executable)) return { status: 'verified', reason: `"${executable}" is a shell builtin` }
  const exists = await executableExists(root, executable)
  if (exists === undefined) return { status: 'unknown', reason: `"${executable}" is a relative path, and this store has no project root to read it from` }
  if (exists) return { status: 'verified', reason: `"${executable}" is available` }
  if (resolved.skippedFlag) return { status: 'unknown', reason: `"${executable}" follows a flag the probe does not know, so it may be that flag's value; it is not on PATH` }
  if (resolved.installsOnDemand) return { status: 'unknown', reason: `"${executable}" is not installed, and ${resolved.wrapper ?? 'its wrapper'} installs it on demand` }
  return { status: 'stale', reason: `"${executable}" is not on PATH` }
}
