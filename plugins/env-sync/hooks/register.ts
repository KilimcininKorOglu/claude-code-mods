import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { commitDir, diffReads, isCommit, listedNames, noteText, REFERENCE_FILES } from './env.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The on/off setting read at session start, and the last error logged, so the same one is logged once. */
type State = { enabled: boolean; lastError?: string }

/** The repository and its HEAD before the commit; `head` is empty before the first commit. */
type Before = { root: string; head: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the commit's env reads were not checked: ${text}`)
  state.lastError = text
}

async function git($: EngineInterface, root: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await $.process.run(['git', ...args], { cwd: root, timeoutMs: 10_000 })
  return { ok: r.exitCode === 0, out: r.stdout }
}

/** The repository root and HEAD, or undefined outside a repository. */
async function beforeCommit($: EngineInterface, state: State, command: string): Promise<Before | undefined> {
  try {
    const top = await git($, commitDir(command, await $.session.cwd()), ['rev-parse', '--show-toplevel'])
    if (!top.ok) return undefined
    const root = top.out.trim()
    const head = await git($, root, ['rev-parse', 'HEAD'])
    return { root, head: head.ok ? head.out.trim() : '' }
  } catch (err) {
    report($, state, err)
    return undefined
  }
}

/** The first reference file at the root, or undefined when the repository has none. */
async function referenceFile($: EngineInterface, root: string): Promise<string | undefined> {
  for (const name of REFERENCE_FILES) if (await $.fs.exists(`${root}/${name}`)) return name
  return undefined
}

/** The note for the commit that moved HEAD, or undefined when it reads no variable the reference file lacks. */
async function commitNote($: EngineInterface, before: Before): Promise<string | undefined> {
  const head = await git($, before.root, ['rev-parse', 'HEAD'])
  const reference = await referenceFile($, before.root)
  if (!head.ok || head.out.trim() === before.head || reference === undefined) return undefined
  const diff = await git($, before.root, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', 'HEAD'])
  if (!diff.ok) throw new Error('git show HEAD failed')
  const listed = listedNames(await $.fs.read(`${before.root}/${reference}`))
  const missing = diffReads(diff.out).filter(r => !listed.has(r.name))
  return missing.length === 0 ? undefined : noteText(missing, reference)
}

async function afterCommit($: EngineInterface, state: State, before: Before, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  try {
    const note = await commitNote($, before)
    state.lastError = undefined
    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  } catch (err) {
    report($, state, err)
    return r
  }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each commit is checked for env reads .env.example lacks' : 'off: commits are not checked'
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'env-sync', description: 'Env variables a commit reads that .env.example lacks: status, on, off (env-sync)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'env-sync' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!state.enabled || !isCommit(e.command)) return next(e)
    const before = await beforeCommit($, state, e.command)
    const r = await next(e)
    return before === undefined ? r : afterCommit($, state, before, r)
  })
}
