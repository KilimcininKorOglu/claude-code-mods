import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'
import { formatSent, indexTranscript } from './time.ts'

interface State {
  /** Time in epoch milliseconds, by message or reply block id (the transcript row's uuid). */
  times: Map<string, number>
  /** Every message id drawn so far; only a new one can take the pending time. */
  seen: Set<string>
  /**
   * The last submitted prompt. The engine can draw one prompt under two ids
   * (a row while it enters, then the stored message), so every new row with
   * its text takes its time, until the next prompt.
   */
  pending: { at: number; text: string } | null
  /** Turns running now; a reply block first drawn while one runs is being written. */
  turns: Set<string>
}

/** Sources whose transcript already holds the messages the session shows. */
const LOAD_SOURCES = new Set(['startup', 'resume', 'fork'])

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads the send times of a transcript's messages, for a resumed session. */
async function loadTranscript($: EngineInterface, state: State, path: string): Promise<void> {
  let text: string
  try {
    if (!(await $.fs.exists(path))) return
    text = await $.fs.read(path)
  } catch (err) {
    $.ui.log(`cannot read the transcript ${path}: ${errorText(err)}`)
    return
  }
  const index = indexTranscript(text)
  for (const [id, at] of index.times) state.times.set(id, at)
  // The resumed messages can be drawn before this hook ran.
  if (index.times.size > 0) $.ui.invalidate('ui.render')
  if (index.broken > 0) $.ui.log(`${index.broken} transcript lines are not JSON: ${path}`, { to: 'debug' })
}

/** The send time of a drawn message; a message first drawn with the pending prompt's text takes its time. */
function sentAt(state: State, id: string, text: string): number | undefined {
  const isNew = !state.seen.has(id)
  state.seen.add(id)
  const known = state.times.get(id)
  if (known !== undefined || !isNew || state.pending?.text !== text.trim()) return known
  state.times.set(id, state.pending.at)
  return state.pending.at
}

/** The time of a reply block; a block first drawn while a turn runs is written now. */
function writtenAt(state: State, id: string, now: number): number | undefined {
  const known = state.times.get(id)
  if (known !== undefined || state.turns.size === 0) return known
  state.times.set(id, now)
  return now
}

/** The engine's drawing with the time in a dim line beneath it. */
function stamped($: EngineInterface, e: RenderInput, drawn: RenderElement, at: number, now: number): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {drawn}
      <Text dimColor>{formatSent(new Date(at), new Date(now))}</Text>
    </Box>
  )
}

export const register: Register = on => {
  const state: State = { times: new Map(), seen: new Set(), pending: null, turns: new Set() }

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id !== undefined) return r
    if (e.source === 'clear') state.times.clear()
    else if (LOAD_SOURCES.has(e.source)) await loadTranscript($, state, e.transcript_path)
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const pending = { at: await $.clock.now(), text: e.text.trim() }
    state.pending = pending
    const r = await next(e)
    // A prompt a hook dropped is never drawn, so its time must not reach a later row.
    if (r.drop !== undefined && state.pending === pending) state.pending = null
    return r
  })

  on('turn.start', async (_, e, next) => {
    state.turns.add(e.turnId)
    return next(e)
  })

  on('turn.complete', async (_, e, next) => {
    state.turns.delete(e.turnId)
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const at = sentAt(state, e.requestId, e.props.text)
    return at === undefined ? drawn : stamped($, e, drawn, at, await $.clock.now())
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const now = await $.clock.now()
    const at = writtenAt(state, e.requestId, now)
    return at === undefined ? drawn : stamped($, e, drawn, at, now)
  })
}
