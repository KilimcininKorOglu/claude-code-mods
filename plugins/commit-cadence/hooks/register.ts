import type { EngineInterface, Register } from 'claude-code'
import { doneLines, doneText, logText, noteText, pathsOf, sectionKey, sidebarLines, statusText } from './cadence.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The consumer this mod writes into the shared sidebar as. */
const CONSUMER = 'commit-cadence'

/**
 * The on/off setting, the directory the session started in, the paths last reported, and whether the
 * model still owes a note for them.
 */
type State = { enabled: boolean; root: string; open: string[]; owed: boolean }

/** The finding the person reads: the sidebar while it is open, else one transcript line. */
async function toPerson($: EngineInterface, key: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    if (await $.sidebar.set({ consumer: CONSUMER, key, title: 'uncommitted work', lines, until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** The uncommitted paths of the session's repository, or undefined when it is not one. */
async function readTree($: EngineInterface, state: State): Promise<string[] | undefined> {
  try {
    const r = await $.process.run(['git', 'status', '--porcelain=v1', '-z'], { cwd: state.root })
    return r.exitCode === 0 ? pathsOf(r.stdout) : undefined
  } catch {
    // git is missing, or the directory is not a repository.
    return undefined
  }
}

/** Whether two lists of paths name the same files, so an unchanged tree is reported once. */
function isSame(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

/**
 * Measures the tree at the turn's end. A tree that is dirty is reported once per set of paths, so a
 * long stretch of edits does not repeat the line; a tree that went clean closes the finding.
 */
async function afterTurn($: EngineInterface, state: State): Promise<void> {
  const paths = await readTree($, state)
  if (paths === undefined) return
  if (paths.length === 0) {
    if (state.open.length === 0) return
    state.open = []
    state.owed = false
    await toPerson($, sectionKey('clean'), doneLines(), doneText())
    return
  }
  if (isSame(state.open, paths)) return
  state.open = paths
  state.owed = true
  await toPerson($, sectionKey(`dirty-${paths.length}`), sidebarLines(paths), logText(paths))
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (!on) {
    state.open = []
    state.owed = false
  }
  return on ? 'on: the tree is measured at the end of each turn' : 'off: the tree is not measured'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') return setEnabled($, state, arg === 'on')
  if (arg !== '' && arg !== 'status') return USAGE
  return statusText(state.enabled, await readTree($, state))
}

export const register: Register = on => {
  const state: State = { enabled: true, root: '', open: [], owed: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    // The session's own directory, because a Bash cd moves what $.session.cwd() answers.
    state.root = await $.session.cwd()
    await $.command.register({
      name: 'commit-cadence',
      description: 'What the working tree holds uncommitted: status, on, off (commit-cadence)',
      argumentHint: '[on | off]',
      immediate: true,
    })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'commit-cadence' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A subagent's turn is its own loop's; only the main loop's end is the person's moment to commit.
    if (state.enabled && e.agentId === undefined) await afterTurn($, state)
    return r
  })

  // The note rides the next prompt, so the model reads it before it starts the next piece of work.
  on('prompt.submit', async (_, e, next) => {
    if (!state.enabled || !state.owed || state.open.length === 0) return next(e)
    state.owed = false
    return next({ ...e, context: [...(e.context ?? []), noteText(state.open)] })
  })
}
