import type { EngineInterface, Register } from 'claude-code'
import { readTurn, tasksOfList, type Tasks } from './tasks.ts'

/** Pokes sent for one stretch of unfinished tasks, until the person sets another limit. */
export const DEFAULT_MAX_POKES = 99

/** The band `/task-poke limit <n>` takes; a value outside it is refused, never clamped. */
const MIN_LIMIT = 1
const MAX_LIMIT = 999

const ENABLED_KEY = 'enabled'
const LIMIT_KEY = 'limit'
const USAGE = 'expects nothing (the status), on, off or limit <n>'
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']
const POKE_TEXT =
  'The task list still has unfinished tasks. Continue with the next pending or in-progress task. ' +
  'If a task is blocked or needs a decision from me, say so and stop.'

/** The section this mod owns in the shared sidebar: the count of the running stretch. */
const SECTION = { consumer: 'task-poke', key: 'pokes' }

type Decision = { kind: 'idle' } | { kind: 'poke'; open: number } | { kind: 'limit' }

/**
 * The on/off setting, the limit, the pokes sent since the last user prompt, the last error logged,
 * and the task list the last reading built. The list is kept because `$.session.messages()` answers
 * the newest messages of a long transcript alone: a task created before that window and never
 * updated inside it is in no later reading of the transcript.
 */
type State = { enabled: boolean; max: number; pokes: number; limitLogged: boolean; lastError?: string; tasks: Tasks | null }

/** Decides what to do after a main-loop turn. `pokes` counts the pokes sent since the last user prompt. */
export function decide(open: number, askedUser: boolean, pokes: number, max: number): Decision {
  if (open === 0 || askedUser) return { kind: 'idle' }
  if (pokes >= max) return { kind: 'limit' }
  return { kind: 'poke', open }
}

/** The limit a `/task-poke limit <word>` argument names, or undefined when it is not one. */
export function limitOf(arg: string): number | undefined {
  if (!/^\d{1,3}$/.test(arg)) return undefined
  const n = Number(arg)
  return n >= MIN_LIMIT && n <= MAX_LIMIT ? n : undefined
}

/** The answer of `/task-poke limit <n>`, or of an argument it cannot read. */
function limitText(limit: number | undefined): string {
  if (limit === undefined) return `limit expects a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}`
  return `limit ${limit}: at most ${limit} poke(s) go out for one stretch of unfinished tasks`
}

/** The count line's colour: red once the pokes stopped, yellow at the last one, green below. */
function countTone(pokes: number, max: number): 'ok' | 'warn' | 'error' {
  if (pokes >= max) return 'error'
  return pokes >= max - 1 ? 'warn' : 'ok'
}

function countText(open: number, pokes: number, max: number): string {
  return `${open} unfinished task${open === 1 ? '' : 's'}, poke ${pokes}/${max}`
}

/**
 * The count the person watches: a section of the shared sidebar, rewritten at each turn. With the
 * sidebar closed, and without that mod installed, only a turn that sent a poke writes the line, as
 * before, because a line per turn would fill the transcript.
 */
async function toCount($: EngineInterface, open: number, pokes: number, max: number, log: boolean): Promise<void> {
  const text = countText(open, pokes, max)
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'task list', lines: [{ text, kind: countTone(pokes, max) }], until: 'session', order: 20 })) return
  } catch {
    // The sidebar mod is not installed.
  }
  if (log) $.ui.log(text)
}

/** Takes the count down, because a finished list has nothing to show. */
async function clearCount($: EngineInterface): Promise<void> {
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod is not installed.
  }
}

/** A finding the next count must not overwrite: an entry in the sidebar's stream, else the transcript line. */
async function toStream($: EngineInterface, key: string, title: string, text: string): Promise<void> {
  try {
    if (await $.sidebar.set({ consumer: 'task-poke', key, title, lines: [{ text, kind: 'error' }], until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(text)
}

/** A plugin prompt runs once the session is idle, so the hook does not wait for it. */
function sendPoke($: EngineInterface): void {
  void $.prompt.submit({ text: POKE_TEXT }).then(
    res => {
      if (res.drop !== undefined) void toStream($, 'dropped', 'poke dropped', `the poke was dropped: ${res.drop}`)
    },
    (err: unknown) => {
      void toStream($, 'failed', 'poke not sent', `the poke was not submitted: ${String(err)}`)
    },
  )
}

/** The limit: the count turns red, and one entry says the pokes stopped. */
async function atLimit($: EngineInterface, state: State, open: number): Promise<void> {
  await toCount($, open, state.pokes, state.max, false)
  if (state.limitLogged) return
  state.limitLogged = true
  await toStream($, 'limit', 'pokes stopped', `stopped after ${state.max} pokes with unfinished tasks. Send a prompt to reset the count.`)
}

/** Writes the limit the person set; it holds across sessions, because it lives in $.store. */
async function setLimit($: EngineInterface, state: State, arg: string): Promise<string> {
  const limit = limitOf(arg)
  if (limit === undefined) return limitText(undefined)
  state.max = limit
  await $.store.set(LIMIT_KEY, limit)
  return limitText(limit)
}

/** The stored limit, or the default when nothing is stored and when the stored value is not one. */
async function readLimit($: EngineInterface): Promise<number> {
  const stored = await $.store.get(LIMIT_KEY)
  return typeof stored === 'number' && limitOf(String(stored)) !== undefined ? stored : DEFAULT_MAX_POKES
}

/**
 * Reads the engine's own task list once, at the session's start, and keeps it as the list every later
 * turn is replayed over. A resumed session brings back tasks the transcript window no longer reaches,
 * and without this reading the mod would count only what that window still holds. The call carries no
 * message into the conversation: it leaves no tool row and the model never sees it (measured).
 */
async function seedTasks($: EngineInterface, state: State): Promise<void> {
  try {
    const answer = await $.tool.call({ tool: 'TaskList' })
    state.tasks = tasksOfList(answer.result) ?? state.tasks
  } catch (err) {
    // The task tools are off, or the engine refused the call. The transcript replay still answers.
    await toStream($, 'unseeded', 'task list', `cannot read the engine's task list, the count is what the transcript holds: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Reads the task list after a main-loop turn and acts on it. The transcript window the engine answers
 * is replayed over the list of the last reading, so a task older than the window still counts. The
 * parser reads that window on every turn, so a bad record fails every later turn too: each distinct
 * error is reported once, and no poke is sent while the list is unreadable.
 */
async function afterTurn($: EngineInterface, state: State): Promise<void> {
  const reading = readTurn(await $.session.messages(), state.tasks)
  if (!reading.ok) {
    if (reading.error !== state.lastError) await toStream($, 'unreadable', 'task list', `cannot read the task list, no poke is sent: ${reading.error}`)
    state.lastError = reading.error
    return
  }
  state.lastError = undefined
  state.tasks = reading.tasks
  const decision = decide(reading.open, reading.askedUser, state.pokes, state.max)
  if (decision.kind === 'limit') return atLimit($, state, reading.open)
  if (decision.kind === 'idle') return reading.open === 0 ? clearCount($) : toCount($, reading.open, state.pokes, state.max, false)
  state.pokes += 1
  await toCount($, decision.open, state.pokes, state.max, true)
  sendPoke($)
}

export const register: Register = on => {
  const state: State = { enabled: true, max: DEFAULT_MAX_POKES, pokes: 0, limitLogged: false, tasks: null }

  const resetCount = (): void => {
    state.pokes = 0
    state.limitLogged = false
  }

  on('session.start', async ($, e, next) => {
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.max = await readLimit($)
    // Claude Code offers TaskCreate and TodoWrite on some models only, and without them there is nothing
    // to count. Turn them on unless the user set the variable. It must be set before next(e).
    if (state.enabled && (await $.env.get('CLAUDE_CODE_ENABLE_TODO_TOOLS')) === undefined) {
      await $.env.set('CLAUDE_CODE_ENABLE_TODO_TOOLS', '1')
    }
    const r = await next(e)
    resetCount()
    if (state.enabled) await seedTasks($, state)
    await $.command.register({
      name: 'task-poke',
      description: 'Continue automatically while the task list has unfinished tasks: status, on, off, limit (task-poke)',
      argumentHint: '[on | off | limit <n>]',
      immediate: true,
    })
    return r
  })

  on('command.run', { command: 'task-poke' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'on' || arg === 'off') {
      state.enabled = arg === 'on'
      await $.store.set(ENABLED_KEY, state.enabled)
      resetCount()
      if (state.enabled) await seedTasks($, state)
      else await clearCount($)
    } else if (arg.startsWith('limit')) {
      return { text: await setLimit($, state, arg.slice(5).trim()) }
    } else if (arg !== '' && arg !== 'status') {
      return { text: USAGE }
    }
    return { text: `task-poke is ${state.enabled ? 'on' : 'off'}, ${state.pokes}/${state.max} pokes since your last prompt` }
  })

  // Only the origin is read. The prompt text passes through untouched. This hook never sees its own pokes.
  on('prompt.submit', async (_, e, next) => {
    const r = await next(e)
    if (USER_ORIGINS.includes(e.origin.kind)) resetCount()
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled || e.agentId !== undefined || e.reason !== 'answer') return r
    await afterTurn($, state)
    return r
  })
}
