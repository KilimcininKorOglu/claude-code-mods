/// <reference path="../types/sidebar.d.ts" />
import type { EngineInterface, Register } from 'claude-code'
import { DEFAULT_CODE, DEFAULT_PLAN, mainLoopMode, parseModel, resolved, routeFor, sectionLines, storedModel, switchText, type Line, type Route } from './split'

const ENABLED_KEY = 'enabled'
const PLAN_KEY = 'plan'
const CODE_KEY = 'code'

const USAGE = 'expects nothing (the status), on, off, plan <model> or code <model>'

const SECTION = { consumer: 'plan-split', key: 'models' }

/**
 * The on/off setting and the route as the store and the environment held them at the last read, the
 * main loop's permission mode as the last classic hook or plan-mode tool call told it, the model the
 * last routed main-loop request went to, and whether the sidebar holds the section now.
 */
type State = { enabled: boolean; route: Route; mode?: string; model?: string; inSidebar: boolean }

/** The section, standing in the sidebar while the pane is open, else `log` as one transcript line. */
async function toPerson($: EngineInterface, state: State, lines: Line[], log: string | undefined): Promise<void> {
  try {
    const taken = await $.sidebar.set({ ...SECTION, title: 'plan-split', lines, until: 'session', order: 7 })
    state.inSidebar = taken
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  if (log !== undefined) $.ui.log(log)
}

async function draw($: EngineInterface, state: State, log?: string): Promise<void> {
  await toPerson($, state, sectionLines(state.route, state.mode, state.model), log)
}

/** Drops the section, when the mod is turned off. */
async function dropSection($: EngineInterface, state: State): Promise<void> {
  state.model = undefined
  if (!state.inSidebar) return
  state.inSidebar = false
  try {
    await $.sidebar.clear(SECTION)
  } catch {
    // The sidebar mod went away since the section was drawn; there is nothing to drop.
  }
}

/** The model ids Claude Code's own aliases stand for in this environment. */
async function aliasEnv($: EngineInterface): Promise<Route['env']> {
  return {
    ANTHROPIC_DEFAULT_FABLE_MODEL: await $.env.get('ANTHROPIC_DEFAULT_FABLE_MODEL'),
    ANTHROPIC_DEFAULT_OPUS_MODEL: await $.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: await $.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL'),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
  }
}

/**
 * Reads the settings from the store, which every window shares, so a change made in another window
 * applies here at the next hook that acts on it. A mod turned off there drops its section, as `off` does.
 */
async function readSettings($: EngineInterface, state: State): Promise<void> {
  const was = state.enabled
  state.enabled = (await $.store.get(ENABLED_KEY)) === true
  const plan = storedModel(await $.store.get(PLAN_KEY), DEFAULT_PLAN)
  const code = storedModel(await $.store.get(CODE_KEY), DEFAULT_CODE)
  state.route = { plan, code, env: await aliasEnv($) }
  if (was && !state.enabled) await dropSection($, state)
}

const sidesText = (route: Route): string => `plan mode on ${resolved(route.plan, route.env)}, every other mode on ${resolved(route.code, route.env)}`

async function switchTo($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  if (!on) {
    await dropSection($, state)
    return 'off: the main loop keeps the session model'
  }
  await draw($, state)
  return `on: ${sidesText(state.route)}`
}

async function setModel($: EngineInterface, state: State, side: 'plan' | 'code', text: string): Promise<string> {
  const parsed = parseModel(text)
  if ('error' in parsed) return parsed.error
  await $.store.set(side === 'plan' ? PLAN_KEY : CODE_KEY, parsed.model)
  state.route = { ...state.route, [side]: parsed.model }
  if (state.enabled) await draw($, state)
  return `${side}: ${resolved(parsed.model, state.route.env)}`
}

function statusText(state: State): string {
  const now = state.mode === undefined ? '' : ` · mode now ${state.mode}`
  return `${state.enabled ? 'on' : 'off'}: ${sidesText(state.route)}${now}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await readSettings($, state)
  const text = args.trim()
  if (text === 'on' || text === 'off') return switchTo($, state, text === 'on')
  const [word, ...rest] = text.split(/\s+/)
  if (word === 'plan' || word === 'code') return setModel($, state, word, rest.join(' '))
  return text === '' ? statusText(state) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: false, route: { plan: DEFAULT_PLAN, code: DEFAULT_CODE, env: {} }, inSidebar: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'plan-split',
      description: 'Run plan mode on one model and every other mode on another: status, on, off, plan <model>, code <model> (plan-split)',
      argumentHint: '[on | off | plan <model> | code <model>]',
    })
    await readSettings($, state)
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'plan-split' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // Every prompt reads the settings, so the turn it starts routes as the store says; turn.step, which runs
  // at each model request, does not read the store.
  on('prompt.submit', async ($, e, next) => {
    await readSettings($, state)
    return next(e)
  })

  // The permission mode reaches a function hook only through the classic hooks: a prompt's carries the mode
  // its turn starts in, a tool's the mode after it, so a Shift+Tab between two tool calls applies at the next.
  on('classic.UserPromptSubmit', async (_, e, next) => {
    state.mode = mainLoopMode(e) ?? state.mode
    return next(e)
  })
  on('classic.PostToolUse', async (_, e, next) => {
    state.mode = mainLoopMode(e) ?? state.mode
    return next(e)
  })

  // An accepted EnterPlanMode or ExitPlanMode moves the mode at once, so the request right after it routes
  // to the new side. ExitPlanMode can land in default, acceptEdits or auto; all of them are the code side,
  // and the tool's classic PostToolUse names the exact one.
  // The generated tool-name union lacks both tools in a headless session, so the name is compared as text.
  on('tool.call', { tool: /^(EnterPlanMode|ExitPlanMode)$/ }, async (_, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && r.deny === undefined && r.isError !== true) state.mode = String(e.tool) === 'EnterPlanMode' ? 'plan' : 'default'
    return r
  })

  // A main-loop request goes to its mode's model. A subagent keeps its own, and a request with no known mode
  // keeps the session's. Each change of model is drawn, or logged while the sidebar is closed.
  on('turn.step', async function* ($, e, next) {
    if (!state.enabled || e.agentId !== undefined) return yield* next(e)
    const model = routeFor(state.mode, state.route)
    if (model === undefined) return yield* next(e)
    if (model !== state.model) {
      state.model = model
      await draw($, state, switchText(state.mode ?? '', model))
    }
    return yield* next(model === e.model ? e : { ...e, model })
  })
}
