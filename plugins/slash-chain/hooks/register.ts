import type { CommandRunInput, CommandRunResult, EngineInterface, Register } from 'claude-code'
import { cancelledText, doneText, parseChain, statusText, stepText, stoppedText, thrownWhy, turnWhy, type Step, type Wait } from './chain.ts'

const ENABLED_KEY = 'enabled'
const COMMAND = 'slash-chain'
const USAGE = 'expects nothing (the status), stop, on or off'

/** The person's own input: the prompt's Enter or the bridge. */
const PERSON: ReadonlySet<string> = new Set(['composer', 'bridge'])

/**
 * The running chain: the step that runs, the steps after it, and what the step waits for. A step that
 * handed the model a prompt (`skill.prompt` came while it ran) waits for its turn; one that opened a
 * focused pane waits for that pane to close. `turnEnded` and `paneClosed` hold an end that came before
 * the step's run resolved.
 */
type Running = {
  step: Step
  left: Step[]
  index: number
  total: number
  wait: Wait
  sawPrompt: boolean
  turnEnded?: string
  pane?: string
  paneClosed: boolean
}

type State = { enabled: boolean; running?: Running }

type Next = (e: CommandRunInput) => Promise<CommandRunResult>

function startStep(state: State, step: Step, left: Step[], index: number, total: number): Running {
  const running: Running = { step, left, index, total, wait: 'run', sawPrompt: false, paneClosed: false }
  state.running = running
  return running
}

function stop($: EngineInterface, state: State, why: string): void {
  const r = state.running
  if (r === undefined) return
  state.running = undefined
  $.ui.log(stoppedText(r.step, why, r.left))
}

function cancel($: EngineInterface, state: State): string {
  const r = state.running
  if (r === undefined) return 'no chain runs'
  state.running = undefined
  const text = cancelledText(r.left)
  $.ui.log(text)
  return text
}

/** Runs the next step from a timer, because a command does not run from inside another's hook; the last one ends the chain. */
function advance($: EngineInterface, state: State, r: Running): void {
  const [step, ...left] = r.left
  if (step === undefined) {
    state.running = undefined
    $.ui.log(doneText(r.total))
    return
  }
  const next = startStep(state, step, left, r.index + 1, r.total)
  $.ui.log(stepText(next.index, next.total, step))
  $.clock.after(0, () => void runStep($, state, next))
}

function endTurn($: EngineInterface, state: State, r: Running, reason: string): void {
  if (reason === 'answer') advance($, state, r)
  else stop($, state, turnWhy(reason))
}

/** After a step's run resolved: wait for the turn it started or the pane it opened, else go on. */
function afterRun($: EngineInterface, state: State, r: Running): void {
  if (state.running !== r) return
  if (r.sawPrompt) {
    if (r.turnEnded === undefined) r.wait = 'turn'
    else endTurn($, state, r, r.turnEnded)
    return
  }
  if (r.pane !== undefined && !r.paneClosed) {
    r.wait = 'pane'
    return
  }
  advance($, state, r)
}

/** A step after the first, run as a plugin: the engine answers it as it would the typed command. */
async function runStep($: EngineInterface, state: State, r: Running): Promise<void> {
  if (state.running !== r) return
  try {
    await $.command.run({ command: r.step.command, args: r.step.args })
  } catch (err) {
    if (state.running === r) stop($, state, thrownWhy(err))
    return
  }
  afterRun($, state, r)
}

/** The typed first command of a chain runs with its own arguments alone; the steps after it wait their turn. */
async function runFirst($: EngineInterface, state: State, e: CommandRunInput, next: Next): Promise<CommandRunResult> {
  const chain = parseChain(e.args)
  if (!state.enabled || chain.rest.length === 0) return next(e)
  const step = { command: e.command, args: chain.head }
  const r = startStep(state, step, chain.rest, 1, chain.rest.length + 1)
  $.ui.log(stepText(1, r.total, step))
  let result: CommandRunResult
  try {
    result = await next({ ...e, args: chain.head })
  } catch (err) {
    if (state.running === r) stop($, state, thrownWhy(err))
    throw err
  }
  afterRun($, state, r)
  return result
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (!on && state.running !== undefined) cancel($, state)
  return on ? 'on: /a && /b runs /b once /a ended well' : 'off: the engine runs the first command alone, as it does without the mod'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  if (word === 'stop') return cancel($, state)
  if (word !== '') return USAGE
  const r = state.running
  return statusText(state.enabled, r === undefined ? undefined : { step: r.step, index: r.index, total: r.total, wait: r.wait })
}

/** Whether a prompt the person sent belongs to the running step (a prompt command's own text) or is this mod's command. */
function isOwnPrompt(text: string, r: Running): boolean {
  return text.startsWith(`/${r.step.command}`) || text.startsWith(`/${COMMAND}`)
}

export const register: Register = on => {
  const state: State = { enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    await $.command.register({ name: COMMAND, description: 'Runs /a && /b one after another: status, stop, on, off (slash-chain)', argumentHint: '[stop | on | off]', immediate: true })
    return r
  })

  // Every command passes here, because a chain starts at whichever command the person typed first.
  on('command.run', async ($, e, next) => {
    if (e.command === COMMAND) return { text: await runCommand($, state, e.args) }
    // A command the person types while a chain waits ends that chain; the new one may start its own.
    if (state.running !== undefined && PERSON.has(e.origin.kind)) cancel($, state)
    return runFirst($, state, e, next)
  })

  on('skill.prompt', async (_, e, next) => {
    if (state.running?.wait === 'run') state.running.sawPrompt = true
    return next(e)
  })

  on('ui.open', async (_, e, next) => {
    const result = await next(e)
    const r = state.running
    if (r?.wait === 'run' && e.focus === true && result.value?.isPlaced === true) r.pane = e.id
    return result
  })

  on('ui.close', async ($, e, next) => {
    const r = state.running
    if (r !== undefined && r.pane === e.id) {
      if (r.wait === 'pane') advance($, state, r)
      else r.paneClosed = true
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const r = state.running
    // A subagent's turn ends inside the step's own; only the main loop's end is the step's.
    if (r === undefined || !r.sawPrompt || e.agentId !== undefined) return result
    if (r.wait === 'turn') endTurn($, state, r, e.reason)
    else if (r.wait === 'run') r.turnEnded = e.reason
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const r = state.running
    const kind = (e.origin as { kind?: string } | undefined)?.kind
    if (r !== undefined && kind !== undefined && PERSON.has(kind) && !isOwnPrompt(e.text, r)) cancel($, state)
    return next(e)
  })
}
