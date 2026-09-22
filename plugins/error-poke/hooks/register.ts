import type { EngineInterface, Register, Timer } from 'claude-code'
import { DEFAULT_MAX_POKES, decide, limitLog, limitOf, limitText, POKE_TEXT, pokeDelay, pokeLog, statusText } from './poke.ts'

const ENABLED_KEY = 'enabled'
const LIMIT_KEY = 'limit'

const USAGE = 'expects nothing (the status), on, off or limit <n>'

/** The origins of a prompt the person sent themselves, which resets the count. */
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']

/**
 * The on/off setting, the limit, the prompts sent since the last prompt of the person, how the last turn
 * ended, and the continue prompt waiting on its timer, so a prompt of the person or `off` can cancel it.
 */
type State = { enabled: boolean; max: number; pokes: number; limitLogged: boolean; lastReason?: string; pending?: Timer }

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line. The model reads nothing of this; it reads the continue prompt itself.
 */
async function toPerson($: EngineInterface, key: string, title: string, text: string): Promise<void> {
  try {
    if (await $.sidebar.set({ consumer: 'error-poke', key, title, lines: [{ text, kind: 'error' }], until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(text)
}

/** A plugin prompt runs once the session is idle, so the hook does not wait for it. */
function sendPoke($: EngineInterface): void {
  void $.prompt.submit({ text: POKE_TEXT }).then(
    res => {
      if (res.drop !== undefined) void toPerson($, 'dropped', 'continue prompt dropped', `the continue prompt was dropped: ${res.drop}`)
    },
    (err: unknown) => {
      void toPerson($, 'failed', 'continue prompt not sent', `the continue prompt was not submitted: ${String(err)}`)
    },
  )
}

/** Acts on one main-loop turn that ended: a continue prompt, the limit, or nothing. */
async function afterTurn($: EngineInterface, state: State, reason: string): Promise<void> {
  const decision = decide(reason, state.pokes, state.max)
  if (decision === 'idle') return
  if (decision === 'limit') {
    if (state.limitLogged) return
    state.limitLogged = true
    await toPerson($, 'limit', 'continue prompts stopped', limitLog(state.max))
    return
  }
  state.pokes += 1
  await toPerson($, `poke-${state.pokes}`, 'turn continued after an API error', pokeLog(state.pokes, state.max))
  state.pending?.cancel()
  state.pending = $.clock.after(pokeDelay(state.pokes), () => {
    state.pending = undefined
    sendPoke($)
  })
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

export const register: Register = on => {
  const state: State = { enabled: true, max: DEFAULT_MAX_POKES, pokes: 0, limitLogged: false }

  const resetCount = (): void => {
    state.pokes = 0
    state.limitLogged = false
    // A continue prompt still waiting is not sent once the person spoke, or turned the mod off.
    state.pending?.cancel()
    state.pending = undefined
  }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.max = await readLimit($)
    resetCount()
    await $.command.register({
      name: 'error-poke',
      description: 'Continue automatically after a turn an API error killed: status, on, off, limit (error-poke)',
      argumentHint: '[on | off | limit <n>]',
      immediate: true,
    })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'error-poke' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'on' || arg === 'off') {
      state.enabled = arg === 'on'
      await $.store.set(ENABLED_KEY, state.enabled)
      resetCount()
    } else if (arg.startsWith('limit')) {
      return { text: await setLimit($, state, arg.slice(5).trim()) }
    } else if (arg !== '') {
      return { text: USAGE }
    }
    return { text: statusText(state.enabled, state.pokes, state.max, state.lastReason) }
  })

  // Only the origin is read. The prompt text passes through untouched. A prompt whose origin the engine
  // does not name is left alone, so a missing origin cannot fail this hook and swallow the submit's answer.
  on('prompt.submit', async (_, e, next) => {
    const r = await next(e)
    const kind = (e.origin as { kind?: string } | undefined)?.kind
    if (kind !== undefined && USER_ORIGINS.includes(kind)) resetCount()
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    state.lastReason = e.reason
    if (state.enabled) await afterTurn($, state, e.reason)
    return r
  })
}
