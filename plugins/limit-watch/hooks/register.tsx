import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'
import {
  barCells,
  barColor,
  clockText,
  durationText,
  markWarned,
  mergeWarned,
  newThresholds,
  limitPace,
  paceText,
  parseTracks,
  percentText,
  profile,
  record,
  resetTime,
  sidebarLines,
  statusLine,
  warningText,
  type Tracks,
} from './limits.ts'

const PANE_ID = 'limit-watch'
const TRACKS_KEY = 'tracks'
const TICK_MS = 60_000
/** Body rows one limit takes in the pane: heading, bar, reset, pace, blank line. */
const ROWS_PER_LIMIT = 5

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** What the hooks share: the last reading, the tracks kept in the store, and the last timer error. */
type State = { limits: readonly SessionRateLimit[]; tracks: Tracks; lastError?: string }

/** Logs each threshold the last sample passed for the first time in its cycle, and marks it. */
function warn($: EngineInterface, state: State, now: number): void {
  for (const limit of state.limits) {
    const track = state.tracks[limit.kind]
    const levels = track === undefined ? [] : newThresholds(track, limit.percentUsed)
    const top = levels.at(0)
    if (top === undefined) continue
    $.ui.log(warningText(limit, top, now))
    state.tracks = markWarned(state.tracks, limit.kind, levels)
  }
}

/** Writes the reading into the shared sidebar; false when the sidebar mod is absent or closed. */
async function toSidebar($: EngineInterface, state: State, now: number): Promise<boolean> {
  try {
    return await $.sidebar.set({
      consumer: 'limit-watch',
      key: 'limits',
      title: 'usage limits',
      lines: sidebarLines(state.limits, state.tracks, now),
      until: 'session',
      order: 10,
    })
  } catch {
    return false
  }
}

/**
 * Reads the limits, records a sample, raises new warnings, stores the tracks and redraws. The stored
 * tracks are read again first, so a warning another session of the account wrote is not repeated.
 */
async function sample($: EngineInterface, state: State): Promise<void> {
  const usage = await $.session.usage()
  const now = await $.clock.now()
  state.limits = usage.rateLimits
  state.tracks = record(state.tracks, state.limits, now)
  state.tracks = mergeWarned(state.tracks, parseTracks(await $.store.get(TRACKS_KEY)) ?? {})
  warn($, state, now)
  await $.store.set(TRACKS_KEY, state.tracks)
  // The sidebar takes the reading while it is open; otherwise the status line shows it, as before.
  $.ui.status((await toSidebar($, state, now)) ? undefined : statusLine(state.limits, state.tracks, now))
  $.ui.invalidate('ui.render')
}

/**
 * Samples and logs a failed read instead of throwing: a timer sample has no hook to fail, and a failed
 * first read must not stop the hook that arms the timer. The same error is logged once.
 */
async function sampleOrLog($: EngineInterface, state: State): Promise<void> {
  try {
    await sample($, state)
    state.lastError = undefined
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    if (text !== state.lastError) $.ui.log(`cannot read the usage limits: ${text}`)
    state.lastError = text
  }
}

export const register: Register = on => {
  const state: State = { limits: [], tracks: {} }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const stored = parseTracks(await $.store.get(TRACKS_KEY))
    if (stored === undefined) $.ui.log('the stored samples have an unknown shape, so the pace starts over')
    state.tracks = stored ?? {}
    await $.command.register({
      name: 'limit-watch',
      description: 'Open or close the usage limits pane (limit-watch)',
      immediate: true,
    })
    // A -p run draws nothing, so only an interactive session samples on a timer. The timer is armed
    // before the first read, so a first read that fails does not leave the session without one.
    if (e.isInteractive) $.clock.every(TICK_MS, () => void sampleOrLog($, state))
    await sampleOrLog($, state)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await sample($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'limit-watch' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
    if (isOpen) {
      await $.ui.close({ id: PANE_ID })
      return { text: 'pane closed' }
    }
    await sample($, state)
    await $.ui.open({ id: PANE_ID, title: 'Usage limits', rows: Math.max(2, state.limits.length * ROWS_PER_LIMIT) })
    return { text: 'pane open. /limit-watch closes it.' }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    const els = $.ui.resolve(e)
    const now = await $.clock.now()
    const width = Math.max(10, e.props.bodyColumns - 2)
    if (state.limits.length === 0) {
      return <els.Text dimColor>No usage limits reported yet. An API key session reports none.</els.Text>
    }
    return (
      <els.Box flexDirection="column">
        {state.limits.map(limit => limitBlock(els, limit, state.tracks, now, width))}
      </els.Box>
    )
  })
}

function limitBlock(els: Elements, limit: SessionRateLimit, tracks: Tracks, now: number, width: number) {
  const { Box, Text } = els
  const p = limitPace(limit, tracks[limit.kind], now)
  const bar = barCells(limit.percentUsed, width)
  const reset = resetTime(limit)
  return (
    <Box key={limit.kind} flexDirection="column" marginBottom={1}>
      <Text bold>{`${profile(limit.kind).name} · ${percentText(limit.percentUsed)} used`}</Text>
      <Text>
        <Text color={barColor(limit.percentUsed)}>{bar.filled}</Text>
        <Text dimColor>{bar.empty}</Text>
      </Text>
      <Text dimColor>
        {reset === undefined ? 'no reset time reported' : `resets ${clockText(reset, now)}, in ${durationText(reset - now)}`}
      </Text>
      <Text dimColor>{paceText(p)}</Text>
    </Box>
  )
}
