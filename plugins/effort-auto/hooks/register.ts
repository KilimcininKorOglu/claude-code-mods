import type { EngineInterface, Register } from 'claude-code'
import { effortLine, keepsCacheAcrossEffort, levelOf, RATE_TIMEOUT_MS, RATER_MODEL, RATER_SYSTEM, raterPrompt, type Level, type Line, type TurnEffort } from './effort.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/**
 * The on/off setting, the level the person's last prompt was rated, the effort of the running and of the
 * last ended main-loop turn, the session's effort as the last main-loop request carried it, whether the
 * sidebar holds the line now, and the model of the last main-loop request, unknown until the first one.
 */
type State = { enabled: boolean; level?: Level; current?: TurnEffort; last?: TurnEffort; session?: string | number; inSidebar: boolean; model?: string }

const SECTION = { consumer: 'effort-auto', key: 'effort' }

/**
 * The person's line: a standing sidebar section while the pane is open, else one transcript line when
 * `logs` is set, which only a rated turn's start sets, so a closed pane gets no line per turn.
 */
async function toPerson($: EngineInterface, state: State, line: Line, logs: boolean): Promise<void> {
  try {
    const taken = await $.sidebar.set({ ...SECTION, title: 'effort', lines: [line], until: 'session', order: 6 })
    state.inSidebar = taken
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  if (logs) $.ui.log(line.text)
}

/** Draws the line as the state holds it now. */
async function drawLine($: EngineInterface, state: State, logs: boolean): Promise<void> {
  await toPerson($, state, effortLine(state.current, state.last, state.session), logs)
}

/** Drops the line, when the mod is turned off. */
async function dropLine($: EngineInterface, state: State): Promise<void> {
  if (!state.inSidebar) return
  state.inSidebar = false
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod went away since the line was drawn; there is nothing to drop.
  }
}

/** The level the rater gives a prompt, or undefined when it did not answer with one. */
async function rate($: EngineInterface, text: string): Promise<Level | undefined> {
  const r = await $.model.complete({ model: RATER_MODEL, system: RATER_SYSTEM, prompt: raterPrompt(text), effort: 'low', maxTokens: 16, timeoutMs: RATE_TIMEOUT_MS })
  if (r.isAnswered) {
    const level = levelOf(r.text)
    if (level === undefined) $.ui.log(`the rater answered "${r.text.slice(0, 40)}", so this turn keeps the session's effort`)
    return level
  }
  $.ui.log(`the rater did not answer (${r.reason}), so this turn keeps the session's effort`)
  return undefined
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    state.level = undefined
    state.current = undefined
    if (word === 'off') await dropLine($, state)
    return word === 'on' ? "on: each prompt is rated and its turn runs at that effort" : "off: every turn runs at the session's effort"
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, inSidebar: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'effort-auto', description: "Run each turn at the effort its prompt needs: status, on, off (effort-auto)", argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'effort-auto' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // Only the person's own prompt, typed while the session is idle, is rated: a prompt typed over a running
  // turn, a task notification or a plugin's prompt leaves the next turn at the session's effort. So is a
  // prompt of a session whose model would lose its cache, as the last main-loop request named it.
  on('prompt.submit', async ($, e, next) => {
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const cacheSafe = state.model === undefined || keepsCacheAcrossEffort(state.model)
    if (state.enabled && typed && e.turnId === undefined && cacheSafe) {
      state.level = await rate($, e.text)
    }
    return next(e)
  })

  // A main-loop request of a rated turn runs at the rated effort, on a model whose cache survives the change.
  // Nothing is stored, so the next turn starts from the session's own effort. A turn's first request draws
  // the line, a turn that was not rated with the session's effort.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || !state.enabled) return yield* next(e)
    state.model = e.model
    state.session = e.effort
    const level = keepsCacheAcrossEffort(e.model) ? state.level : undefined
    if (state.current === undefined) {
      state.current = level === undefined ? { value: e.effort, rated: false } : { value: level, rated: true }
      await drawLine($, state, level !== undefined)
    }
    return yield* next(level === undefined ? e : { ...e, effort: level })
  })

  // The rated effort ends with the turn: the line keeps it as the last turn's, beside the session's effort.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) state.level = undefined
    if (e.agentId === undefined && state.current !== undefined) {
      state.last = state.current
      state.current = undefined
      await drawLine($, state, false)
    }
    return next(e)
  })
}
