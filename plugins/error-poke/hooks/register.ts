import type { EngineInterface, Register } from 'claude-code'
import { decide, limitLog, POKE_TEXT, pokeLog, statusText } from './poke.ts'

const ENABLED_KEY = 'enabled'

/** The origins of a prompt the person sent themselves, which resets the count. */
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']

/** The on/off setting, the prompts sent since the last prompt of the person, and how the last turn ended. */
type State = { enabled: boolean; pokes: number; limitLogged: boolean; lastReason?: string }

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
  const decision = decide(reason, state.pokes)
  if (decision === 'idle') return
  if (decision === 'limit') {
    if (state.limitLogged) return
    state.limitLogged = true
    await toPerson($, 'limit', 'continue prompts stopped', limitLog())
    return
  }
  state.pokes += 1
  await toPerson($, `poke-${state.pokes}`, 'turn continued after an API error', pokeLog(state.pokes))
  sendPoke($)
}

export const register: Register = on => {
  const state: State = { enabled: true, pokes: 0, limitLogged: false }

  const resetCount = (): void => {
    state.pokes = 0
    state.limitLogged = false
  }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    resetCount()
    await $.command.register({
      name: 'error-poke',
      description: 'Continue automatically after a turn an API error killed: status, on, off (error-poke)',
      argumentHint: '[on | off]',
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
    }
    return { text: statusText(state.enabled, state.pokes, state.lastReason) }
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
