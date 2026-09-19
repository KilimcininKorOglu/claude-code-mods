import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { fingerprintOf, type TreeState } from './fingerprint.ts'
import { emptyHistory, listText, notesFor, readHistory, record, type History } from './history.ts'
import { isTestCommand, parseOutput } from './parse.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the flaky tests), reset, reset <test id>, on or off'

/** The repository a run belongs to, and its fingerprint before the run. */
type Tree = { project: string; fp: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

/** Runs git read-only by argv; another exit code answers undefined. */
async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | undefined> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 })
  return r.exitCode === 0 ? r.stdout : undefined
}

/** The repository's common git dir (shared by its worktrees), or undefined outside git. */
async function projectOf($: EngineInterface, cwd: string): Promise<string | undefined> {
  return (await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']))?.trim()
}

/** The repository and the fingerprint of its working tree, or undefined outside git or for a diff too large. */
async function treeOf($: EngineInterface, cwd: string): Promise<Tree | undefined> {
  const project = await projectOf($, cwd)
  if (project === undefined) return undefined
  const head = (await git($, cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])) ?? ''
  const diffArgs = head === '' ? ['diff', '--no-ext-diff', '--no-color'] : ['diff', '--no-ext-diff', '--no-color', 'HEAD']
  const state: TreeState = { head, diff: (await git($, cwd, diffArgs)) ?? '', untracked: (await git($, cwd, ['ls-files', '--others', '--exclude-standard'])) ?? '' }
  const fp = fingerprintOf(state)
  return fp === undefined ? undefined : { project, fp }
}

/** The project's stored history; a value of another shape is reported and started over. */
async function loadHistory($: EngineInterface, project: string): Promise<History> {
  const h = readHistory(await $.store.get(`runs:${project}`))
  if (h !== undefined) return h
  $.ui.log(`the stored runs of ${project} have an unknown shape; starting over`)
  return emptyHistory()
}

/** A run that finished in the foreground; an interrupted or backgrounded one printed only part of its output. */
function finished(r: ToolCallResult<'Bash'>): boolean {
  if (r.deny !== undefined) return false
  if (r.isError === true) return true
  return !r.result.interrupted && r.result.backgroundTaskId === undefined
}

/** Records the run and answers the notes for its flaky failures. */
async function learn($: EngineInterface, tree: Tree, command: string, r: ToolCallResult<'Bash'>): Promise<string[]> {
  const outcome = parseOutput(r.text ?? '')
  const exitedOk = r.isError !== true
  const before = await loadHistory($, tree.project)
  if (outcome.failed.length === 0 && outcome.passed.length === 0 && !(exitedOk && command in before.failedBy)) return []
  const now = await $.clock.now()
  const after = record(before, { now, fp: tree.fp, command, outcome, exitedOk })
  await $.store.set(`runs:${tree.project}`, after)
  return notesFor(after, outcome.failed, now)
}

function withNotes(r: ToolCallResult<'Bash'>, notes: string[]): ToolCallResult<'Bash'> {
  if (notes.length === 0 || r.deny !== undefined) return r
  return { ...r, context: [...(r.context ?? []), notes.join('\n')] }
}

/** Forgets the runs of one test, or of the whole repository when `id` is empty. */
async function forget($: EngineInterface, project: string, id: string): Promise<string> {
  if (id === '') {
    await $.store.delete(`runs:${project}`)
    return 'the runs of this repository are forgotten'
  }
  const h = await loadHistory($, project)
  if (h.tests[id] === undefined) return `no runs of ${id}`
  delete h.tests[id]
  await $.store.set(`runs:${project}`, h)
  return `the runs of ${id} are forgotten`
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [word = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    return word === 'on' ? 'on: test runs are recorded' : 'off: test runs are not recorded; the stored runs stay'
  }
  const project = await projectOf($, await $.session.cwd())
  if (project === undefined) return 'not in a git repository: no runs are recorded here'
  if (word === '') return `${(await isEnabled($)) ? 'on' : 'off'} · ${listText(await loadHistory($, project), await $.clock.now())}`
  return word === 'reset' ? forget($, project, rest.join(' ')) : USAGE
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'flaky',
      description: 'Flaky tests of this repository: the list, reset [test id], on, off (flaky-memory)',
      argumentHint: '[reset [test id] | on | off]',
    })
    return r
  })

  on('command.run', { command: 'flaky' }, async ($, e) => ({ text: await runCommand($, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isTestCommand(e.command) || !(await isEnabled($))) return next(e)
    let tree: Tree | undefined
    try {
      tree = await treeOf($, await $.session.cwd())
    } catch (err) {
      $.ui.log(`this test run is not recorded: ${errorText(err)}`)
    }
    const r = await next(e)
    if (tree === undefined || !finished(r)) return r
    try {
      return withNotes(r, await learn($, tree, e.command, r))
    } catch (err) {
      $.ui.log(`this test run is not recorded: ${errorText(err)}`)
      return r
    }
  })
}
