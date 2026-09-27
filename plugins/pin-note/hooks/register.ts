import type { EngineInterface, Register } from 'claude-code'
import { addedText, contextText, droppedText, listText, noSuchText, OFF_TEXT, parseArgs, pinsKey, sentText, type Action } from './pins.ts'

const ENABLED_KEY = 'enabled'

/** Whether the mod is on, the session the notes belong to, and its notes in pin order. */
type State = { enabled: boolean; sessionId?: string; pins: string[] }

async function savePins($: EngineInterface, state: State): Promise<void> {
  if (state.sessionId !== undefined) await $.store.set(pinsKey(state.sessionId), state.pins)
}

async function loadPins($: EngineInterface, sessionId: string): Promise<string[]> {
  const stored = await $.store.get(pinsKey(sessionId))
  return Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : []
}

async function dropPin($: EngineInterface, state: State, index: number): Promise<string> {
  const text = state.pins[index - 1]
  if (text === undefined) return noSuchText(index, state.pins.length)
  state.pins.splice(index - 1, 1)
  await savePins($, state)
  return droppedText(index, text)
}

async function addPin($: EngineInterface, state: State, text: string): Promise<string> {
  state.pins.push(text)
  await savePins($, state)
  return addedText(state.pins.length, text)
}

async function runCommand($: EngineInterface, state: State, action: Action): Promise<string> {
  if (action.kind === 'enable') {
    await $.store.set(ENABLED_KEY, action.on)
    state.enabled = action.on
    return listText(state.enabled, state.pins)
  }
  if (action.kind === 'list') return listText(state.enabled, state.pins)
  if (!state.enabled) return OFF_TEXT
  return action.kind === 'drop' ? dropPin($, state, action.index) : addPin($, state, action.text)
}

/**
 * Follows the session the engine names: /clear starts a new one and the notes go with it; any other new
 * session (a resume) takes the notes stored under its own id.
 */
async function follow($: EngineInterface, state: State, sessionId: string, source: string): Promise<void> {
  if (sessionId === state.sessionId) return
  state.sessionId = sessionId
  if (source === 'clear') await savePins($, state)
  else state.pins = await loadPins($, sessionId)
}

export const register: Register = on => {
  const state: State = { enabled: false, pins: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'pin-note', description: 'Pin notes the model gets again after each compaction and /clear: list, on, off, drop <n>, or a note (pin-note)', argumentHint: '[<note> | drop <n> | on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) === true
    state.sessionId = await $.session.id()
    state.pins = await loadPins($, state.sessionId)
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'pin-note' }, async ($, e) => ({ text: await runCommand($, state, parseArgs(String(e.args ?? ''))) }))

  // A compaction or /clear starts the main loop's context again, so the notes go into it word for word.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id !== undefined) return r
    await follow($, state, e.session_id, e.source)
    if (!state.enabled || state.pins.length === 0 || (e.source !== 'compact' && e.source !== 'clear')) return r
    $.ui.log(sentText(state.pins.length, e.source))
    return { ...r, additionalContext: [...(r.additionalContext ?? []), contextText(state.pins, e.source)] }
  })
}
