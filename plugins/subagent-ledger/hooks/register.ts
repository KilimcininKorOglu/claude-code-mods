import type { EngineInterface, Register } from 'claude-code'
import { DEFAULT_LIMIT_K, limitOf, limitText, sidebarLines, statusAfter, statusText, tokensOf, totalText, type Run, type Usage } from './ledger.ts'

const ENABLED_KEY = 'enabled'
const LIMIT_KEY = 'limit'

const USAGE = 'expects nothing (the status), on, off or limit <k>'

/** The section this mod owns in the shared sidebar. */
const SECTION = { consumer: 'subagent-ledger', key: 'subagents' }

/** The on/off setting, the limit in thousands of tokens, and one run per subagent of this session. */
type State = { enabled: boolean; limitK: number; runs: Map<string, Run> }

/**
 * The ledger the person watches: a section of the shared sidebar, rewritten at each subagent turn. With
 * the sidebar closed, and without that mod installed, the totals go to the status line instead.
 */
async function show($: EngineInterface, state: State): Promise<void> {
  const runs = [...state.runs.values()]
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'subagents', lines: sidebarLines(runs, state.limitK), until: 'session', order: 20 })) {
      $.ui.status(undefined)
      return
    }
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.status(totalText(runs))
}

/** Takes the ledger down, because a session with no subagent has nothing to show. */
async function clearShown($: EngineInterface): Promise<void> {
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.status(undefined)
}

/** The run of one subagent, started with what its spawn said it is. */
function runOf(state: State, agentId: string): Run {
  const had = state.runs.get(agentId)
  if (had !== undefined) return had
  const made: Run = { type: 'agent', description: '', model: '', turns: 0, ms: 0, tokens: 0, status: 'running' }
  state.runs.set(agentId, made)
  return made
}

/** Draws a subagent's row as running again, once per run: a SendMessage resumes a subagent that had answered. */
async function markRunning($: EngineInterface, state: State, agentId: string): Promise<void> {
  const run = runOf(state, agentId)
  if (run.status === 'running') return
  run.status = 'running'
  await show($, state)
}

/** The fields of a subagent's `turn.complete` the ledger counts. */
type Ended = { agentId: string; durationMs: number; reason: string; usage?: Usage }

/** Counts one turn of one subagent (its turns, duration, tokens and model) and where the turn left it. */
async function countTurn($: EngineInterface, state: State, e: Ended): Promise<void> {
  const run = runOf(state, e.agentId)
  const usage = e.usage
  run.turns += 1
  run.ms += e.durationMs
  run.tokens += tokensOf(usage)
  run.status = statusAfter(e.reason)
  // The turn's own model is what answered; the spawn's resolved model stands until a turn names one.
  if (usage?.model !== undefined) run.model = usage.model
  await show($, state)
}

/** Writes the limit the person set; it holds across sessions, because it lives in $.store. */
async function setLimit($: EngineInterface, state: State, arg: string): Promise<string> {
  const limit = limitOf(arg)
  if (limit === undefined) return limitText(undefined)
  state.limitK = limit
  await $.store.set(LIMIT_KEY, limit)
  await show($, state)
  return limitText(limit)
}

/** The stored limit, or the default when nothing is stored and when the stored value is not one. */
async function readLimit($: EngineInterface): Promise<number> {
  const stored = await $.store.get(LIMIT_KEY)
  return typeof stored === 'number' && limitOf(String(stored)) !== undefined ? stored : DEFAULT_LIMIT_K
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (on) await show($, state)
  else await clearShown($)
  return on ? 'on: each subagent is counted' : 'off: subagents are not counted; the counts stay'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') return setEnabled($, state, arg === 'on')
  if (arg.startsWith('limit')) return setLimit($, state, arg.slice(5).trim())
  if (arg !== '' && arg !== 'status') return USAGE
  return statusText(state.enabled, [...state.runs.values()], state.limitK)
}

export const register: Register = on => {
  const state: State = { enabled: true, limitK: DEFAULT_LIMIT_K, runs: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.limitK = await readLimit($)
    await $.command.register({
      name: 'subagent-ledger',
      description: 'What each subagent of this session spent: status, on, off, limit <k> (subagent-ledger)',
      argumentHint: '[on | off | limit <k>]',
      immediate: true,
    })
    return r
  })

  // The engine prints the plugin name in front of command text and the status line, so the texts do not repeat it.
  on('command.run', { command: 'subagent-ledger' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // The spawn names what the subagent is and draws it running; only its own turns say what it spent.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled || r.agentId === undefined) return r
    state.runs.set(r.agentId, { type: e.subagentType, description: e.description, model: r.model, turns: 0, ms: 0, tokens: 0, status: 'running' })
    await show($, state)
    return r
  })

  // A subagent's model request means its loop runs, also after a SendMessage resumed it.
  on('turn.step', async function* ($, e, next) {
    if (state.enabled && e.agentId !== undefined) await markRunning($, state, e.agentId)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled || e.agentId === undefined) return r
    await countTurn($, state, { agentId: e.agentId, durationMs: e.durationMs, reason: e.reason, usage: e.usage })
    return r
  })
}
