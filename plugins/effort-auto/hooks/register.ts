import type { EngineInterface, Register } from 'claude-code'
import { keepsCacheAcrossEffort, levelOf, RATE_TIMEOUT_MS, RATER_MODEL, RATER_SYSTEM, raterPrompt, turnLine, type Level, type Line } from './effort.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/**
 * The on/off setting, the level the person's last prompt was rated, whether this turn's line was drawn,
 * whether the sidebar holds that line now, and the model of the last main-loop request, unknown until the
 * first one.
 */
type State = { enabled: boolean; level?: Level; shown: boolean; inSidebar: boolean; model?: string }

const SECTION = { consumer: 'effort-auto', key: 'effort' }

/** The person's line: a standing sidebar section while the pane is open, else one transcript line. */
async function toPerson($: EngineInterface, state: State, line: Line): Promise<void> {
  try {
    const taken = await $.sidebar.set({ ...SECTION, title: 'effort', lines: [line], until: 'session', order: 6 })
    state.inSidebar = taken
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line.text)
}

/** Drops the sidebar line of an earlier rated turn, so it never stands beside a turn that runs at another effort. */
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
    return word === 'on' ? "on: each prompt is rated and its turn runs at that effort" : "off: every turn runs at the session's effort"
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, shown: false, inSidebar: false }

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
      state.shown = false
    }
    return next(e)
  })

  // A main-loop request of a rated turn runs at the rated effort, on a model whose cache survives the change.
  // Nothing is stored, so the next turn starts from the session's own effort, and its request drops the line.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    state.model = e.model
    const level = state.level
    if (level === undefined || !keepsCacheAcrossEffort(e.model)) {
      await dropLine($, state)
      return yield* next(e)
    }
    if (!state.shown) {
      state.shown = true
      await toPerson($, state, turnLine(level, e.effort))
    }
    return yield* next({ ...e, effort: level })
  })

  on('turn.complete', async (_, e, next) => {
    if (e.agentId === undefined) state.level = undefined
    return next(e)
  })
}
