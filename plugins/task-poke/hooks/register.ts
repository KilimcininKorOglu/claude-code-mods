import type { EngineInterface, Register } from 'claude-code'
import { readTurn } from './tasks.ts'

const MAX_POKES = 5
const ENABLED_KEY = 'enabled'
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']
const POKE_TEXT =
  'The task list still has unfinished tasks. Continue with the next pending or in-progress task. ' +
  'If a task is blocked or needs a decision from me, say so and stop.'

/** The section this mod owns in the shared sidebar: the count of the running stretch. */
const SECTION = { consumer: 'task-poke', key: 'pokes' }

type Decision = { kind: 'idle' } | { kind: 'poke'; open: number } | { kind: 'limit' }

/** The on/off setting, the pokes sent since the last user prompt, and the last error logged. */
type State = { enabled: boolean; pokes: number; limitLogged: boolean; lastError?: string }

/** Decides what to do after a main-loop turn. `pokes` counts the pokes sent since the last user prompt. */
export function decide(open: number, askedUser: boolean, pokes: number): Decision {
  if (open === 0 || askedUser) return { kind: 'idle' }
  if (pokes >= MAX_POKES) return { kind: 'limit' }
  return { kind: 'poke', open }
}

/** The count line's colour: red once the pokes stopped, yellow at the last one, green below. */
function countTone(pokes: number): 'ok' | 'warn' | 'error' {
  if (pokes >= MAX_POKES) return 'error'
  return pokes >= MAX_POKES - 1 ? 'warn' : 'ok'
}

function countText(open: number, pokes: number): string {
  return `${open} unfinished tasks, poke ${pokes}/${MAX_POKES}`
}

/**
 * The count the person watches: a section of the shared sidebar, rewritten at each turn. With the
 * sidebar closed, and without that mod installed, only a turn that sent a poke writes the line, as
 * before, because a line per turn would fill the transcript.
 */
async function toCount($: EngineInterface, open: number, pokes: number, log: boolean): Promise<void> {
  const text = countText(open, pokes)
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'task list', lines: [{ text, kind: countTone(pokes) }], until: 'session', order: 20 })) return
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
  await toCount($, open, state.pokes, false)
  if (state.limitLogged) return
  state.limitLogged = true
  await toStream($, 'limit', 'pokes stopped', `stopped after ${MAX_POKES} pokes with unfinished tasks. Send a prompt to reset the count.`)
}

/**
 * Reads the task list after a main-loop turn and acts on it. The parser reads the whole transcript on
 * every turn, so a bad record fails every later turn too: each distinct error is reported once, and no
 * poke is sent while the list is unreadable.
 */
async function afterTurn($: EngineInterface, state: State): Promise<void> {
  const reading = readTurn(await $.session.messages())
  if (!reading.ok) {
    if (reading.error !== state.lastError) await toStream($, 'unreadable', 'task list', `cannot read the task list, no poke is sent: ${reading.error}`)
    state.lastError = reading.error
    return
  }
  state.lastError = undefined
  const decision = decide(reading.open, reading.askedUser, state.pokes)
  if (decision.kind === 'limit') return atLimit($, state, reading.open)
  if (decision.kind === 'idle') return reading.open === 0 ? clearCount($) : toCount($, reading.open, state.pokes, false)
  state.pokes += 1
  await toCount($, decision.open, state.pokes, true)
  sendPoke($)
}

export const register: Register = on => {
  const state: State = { enabled: true, pokes: 0, limitLogged: false }

  const resetCount = (): void => {
    state.pokes = 0
    state.limitLogged = false
  }

  on('session.start', async ($, e, next) => {
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    // Claude Code offers TaskCreate and TodoWrite on some models only, and without them there is nothing
    // to count. Turn them on unless the user set the variable. It must be set before next(e).
    if (state.enabled && (await $.env.get('CLAUDE_CODE_ENABLE_TODO_TOOLS')) === undefined) {
      await $.env.set('CLAUDE_CODE_ENABLE_TODO_TOOLS', '1')
    }
    const r = await next(e)
    resetCount()
    await $.command.register({
      name: 'task-poke',
      description: 'Continue automatically while the task list has unfinished tasks: on, off or status (task-poke)',
      argumentHint: '[on | off | status]',
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
      if (!state.enabled) await clearCount($)
    }
    return { text: `task-poke is ${state.enabled ? 'on' : 'off'}, ${state.pokes}/${MAX_POKES} pokes since your last prompt` }
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
