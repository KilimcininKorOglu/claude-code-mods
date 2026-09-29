import type { EngineInterface, Register, TurnStepInput } from 'claude-code'
import { allowedLine, effortLine, keepsCacheAcrossEffort, levelFor, levelsOf, parseLevels, RATE_TIMEOUT_MS, RATER_MODEL, RATER_SYSTEM, raterPrompt, ratingOf, type Level, type Line, type Rating, type TurnEffort } from './effort.ts'

const ENABLED_KEY = 'enabled'
const LEVELS_KEY = 'levels'

const USAGE = 'expects nothing (the status), on, off, or levels all | <level ...>'

/** A subagent started in a rated turn: that turn's level, and whether its first request was checked. */
type Pin = { level: Level; checked: boolean }

/**
 * The on/off setting and the allowed levels as the store held them at the last read, the rating of the
 * person's last prompt, the effort of the running and of the last ended main-loop turn, the session's
 * effort as the last main-loop request carried it, whether the sidebar holds the section now, the model
 * of the last main-loop request, unknown until the first one, and the level of each subagent a rated
 * turn started.
 */
type State = {
  enabled: boolean
  allowed: Level[]
  rating?: Rating
  current?: TurnEffort
  last?: TurnEffort
  session?: string | number
  inSidebar: boolean
  model?: string
  pins: Map<string, Pin>
}

const SECTION = { consumer: 'effort-auto', key: 'effort' }

/**
 * The person's section: standing in the sidebar while the pane is open, else one transcript line when
 * `log` is given, which only a rated turn's start gives, so a closed pane gets no line per turn.
 */
async function toPerson($: EngineInterface, state: State, lines: Line[], log: string | undefined): Promise<void> {
  try {
    const taken = await $.sidebar.set({ ...SECTION, title: 'effort', lines, until: 'session', order: 6 })
    state.inSidebar = taken
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  if (log !== undefined) $.ui.log(log)
}

/** The effort line once a request told the session's effort, and the allowed levels under it. */
function sectionLines(state: State): Line[] {
  const known = state.current !== undefined || state.last !== undefined || state.session !== undefined
  const allowed = allowedLine(state.allowed)
  return known ? [effortLine(state.current, state.last, state.session), allowed] : [allowed]
}

/** Draws the section as the state holds it now; `logs` writes the effort line when the pane is closed. */
async function drawLine($: EngineInterface, state: State, logs: boolean): Promise<void> {
  const lines = sectionLines(state)
  await toPerson($, state, lines, logs ? lines[0].text : undefined)
}

/** Drops the section, when the mod is turned off. */
async function dropLine($: EngineInterface, state: State): Promise<void> {
  if (!state.inSidebar) return
  state.inSidebar = false
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod went away since the section was drawn; there is nothing to drop.
  }
}

/** Forgets the rating, the running turn and every subagent's level, and drops the section. */
async function turnOff($: EngineInterface, state: State): Promise<void> {
  state.rating = undefined
  state.current = undefined
  state.pins.clear()
  await dropLine($, state)
}

/**
 * Reads the on/off setting and the allowed levels from the store, which every window shares, so a change
 * made in another window applies here at the next hook that acts on it. A mod turned off there drops its
 * rating and its section, as `off` does; new allowed levels redraw the section.
 */
async function readSettings($: EngineInterface, state: State): Promise<void> {
  const was = state.enabled
  const allowed = levelsOf(await $.store.get(LEVELS_KEY))
  const changed = allowed.join() !== state.allowed.join()
  state.allowed = allowed
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
  if (!state.enabled && was) return turnOff($, state)
  if (changed && state.enabled && state.inSidebar) await drawLine($, state, false)
}

/**
 * The level a prompt's turn runs at and whether the prompt named it, or undefined when the rater did not
 * answer with a level. The rater rates on the whole scale; a rated level the person does not allow is
 * moved to the nearest allowed one, and so is a level the rater calls named that the prompt does not hold.
 */
async function rate($: EngineInterface, text: string, allowed: Level[]): Promise<Rating | undefined> {
  const r = await $.model.complete({ model: RATER_MODEL, system: RATER_SYSTEM, prompt: raterPrompt(text), effort: 'low', maxTokens: 16, timeoutMs: RATE_TIMEOUT_MS })
  if (!r.isAnswered) {
    $.ui.log(`the rater did not answer (${r.reason}), so this turn keeps the session's effort`)
    return undefined
  }
  const rating = ratingOf(r.text, text)
  if (rating === undefined) {
    $.ui.log(`the rater answered "${r.text.slice(0, 40)}", so this turn keeps the session's effort`)
    return undefined
  }
  return { level: levelFor(rating, allowed), named: rating.named }
}

async function switchTo($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  if (!on) {
    await turnOff($, state)
    return "off: every turn runs at the session's effort"
  }
  state.rating = undefined
  state.current = undefined
  return 'on: each prompt is rated and its turn runs at that effort'
}

/** `levels` shows the allowed levels; `levels all` or `levels <level ...>` stores them. */
async function setLevels($: EngineInterface, state: State, args: string): Promise<string> {
  if (args === '') {
    await readSettings($, state)
    return `allowed ${state.allowed.join(', ')}`
  }
  const levels = parseLevels(args)
  if (typeof levels === 'string') return levels
  await $.store.set(LEVELS_KEY, levels)
  state.allowed = levels
  if (state.enabled) await drawLine($, state, false)
  return `allowed ${levels.join(', ')}: a rated turn runs at the nearest of these, and a level a prompt names still applies`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const text = args.trim()
  if (text === 'on' || text === 'off') return switchTo($, state, text === 'on')
  const [word, ...rest] = text.split(/\s+/)
  if (word === 'levels') return setLevels($, state, rest.join(' '))
  if (text !== '') return USAGE
  await readSettings($, state)
  return state.enabled ? `on · allowed ${state.allowed.join(', ')}` : 'off'
}

/** A rated main-loop turn's level, which the subagents it starts run at. */
const ratedLevel = (t: TurnEffort | undefined): Level | undefined => (t?.rated === true ? t.level : undefined)

/** Pins a started subagent to the level its parent runs at: the rated main-loop turn's, or its parent subagent's. */
function pinAgent(state: State, agentId: string, parent: string | undefined): void {
  const level = parent === undefined ? ratedLevel(state.current) : state.pins.get(parent)?.level
  if (level !== undefined) state.pins.set(agentId, { level, checked: false })
}

/**
 * A subagent's request goes out at its pinned level, on a model whose cache survives the change. Measured
 * on 2.1.284: a subagent's requests carry the session's effort. So one whose first request carries another
 * has its own effort in its definition, keeps it, and loses the pin.
 */
function subagentStep(state: State, e: TurnStepInput, agentId: string): TurnStepInput {
  const pin = state.pins.get(agentId)
  if (pin === undefined || !keepsCacheAcrossEffort(e.model)) return e
  if (!pin.checked) {
    pin.checked = true
    if (e.effort !== state.session) {
      state.pins.delete(agentId)
      return e
    }
  }
  return { ...e, effort: pin.level }
}

export const register: Register = on => {
  const state: State = { enabled: true, allowed: levelsOf(undefined), inSidebar: false, pins: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'effort-auto', description: "Run each turn at the effort its prompt needs: status, on, off, levels (effort-auto)", argumentHint: '[on | off | levels all | levels <level ...>]' })
    await readSettings($, state)
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'effort-auto' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // Only the person's own prompt, typed while the session is idle, is rated: a prompt typed over a running
  // turn, a task notification or a plugin's prompt leaves the next turn at the session's effort. So is a
  // prompt of a session whose model would lose its cache, as the last main-loop request named it. Every
  // prompt reads the settings, so the turn it starts runs as the store says; turn.step, which runs at each
  // model request, does not read the store.
  on('prompt.submit', async ($, e, next) => {
    await readSettings($, state)
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const cacheSafe = state.model === undefined || keepsCacheAcrossEffort(state.model)
    if (state.enabled && typed && e.turnId === undefined && cacheSafe) {
      state.rating = await rate($, e.text, state.allowed)
    }
    return next(e)
  })

  // A main-loop request of a rated turn runs at the rated effort, on a model whose cache survives the change.
  // Nothing is stored, so the next turn starts from the session's own effort. A turn's first request draws
  // the section, a turn that was not rated with the session's effort. A subagent's request runs at the
  // level of the rated turn that started it.
  on('turn.step', async function* ($, e, next) {
    if (!state.enabled) return yield* next(e)
    if (e.agentId !== undefined) return yield* next(subagentStep(state, e, e.agentId))
    state.model = e.model
    state.session = e.effort
    const rating = keepsCacheAcrossEffort(e.model) ? state.rating : undefined
    if (state.current === undefined) {
      state.current = rating === undefined ? { rated: false, value: e.effort } : { rated: true, level: rating.level, named: rating.named }
      await drawLine($, state, rating !== undefined)
    }
    return yield* next(rating === undefined ? e : { ...e, effort: rating.level })
  })

  // A subagent started while a rated turn runs, directly or by one of its subagents, takes that level.
  on('agent.spawn', async (_, e, next) => {
    const r = await next(e)
    if (state.enabled && r.agentId !== undefined) pinAgent(state, r.agentId, e.parentAgentId)
    return r
  })

  // The rated effort ends with the turn: the section keeps it as the last turn's, beside the session's
  // effort. A subagent's level ends with its own run.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      state.pins.delete(e.agentId)
      return next(e)
    }
    state.rating = undefined
    if (state.current !== undefined) {
      state.last = state.current
      state.current = undefined
      await drawLine($, state, false)
    }
    return next(e)
  })
}
