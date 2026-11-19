import type {} from '../types/sidebar'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'
import {
  barCells,
  barColor,
  clockText,
  durationText,
  isScopedDue,
  markWarned,
  mergeWarned,
  modelNoteText,
  newThresholds,
  noteLevels,
  limitPace,
  paceText,
  parseScopedRecord,
  parseTracks,
  percentText,
  profile,
  record,
  resetTime,
  retryAfterMs,
  scopedLimits,
  sidebarLines,
  statusLine,
  toolText,
  warningText,
  type Noted,
  type Tracks,
} from './limits'

const PANE_ID = 'limit-watch'
const TRACKS_KEY = 'tracks'
const ENABLED_KEY = 'enabled'
const TICK_MS = 60_000
/** Body rows one limit takes in the pane: heading, bar, reset, pace, blank line. */
const ROWS_PER_LIMIT = 5

const USAGE = 'expects nothing (opens or closes the pane), on or off'
const OFF_TEXT = 'off. /limit-watch on starts it again.'

/** The tool the model reads the limits through: listed from the session's start, declared once. */
const TOOL_NAME = 'limits'
const TOOL_DESCRIPTION = "Read the account's usage limits now: each limit's percentage used, reset time, pace and when it reaches 100%. Call it before long or costly work, or when the person asks about limits."
const TOOL_OFF = 'limit-watch is off, so it reads no limits; the person turns it on with /limit-watch on.'

/**
 * The account's usage endpoint: the only source of the per-model weekly limits (Fable), which
 * `$.session.usage()` does not report. The engine sets the credential header; the mod never sees it.
 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_BETA = 'oauth-2025-04-20'
/** The account reads the usage endpoint at most this often over all its sessions, and never by the idle timer. */
const SCOPED_MS = 5 * 60_000
/** The store key of the shared last read of the usage endpoint. */
const SCOPED_KEY = 'scoped'

/** How a sample treats the usage endpoint: not at all, or when the account's last read is old enough. */
type ScopedRead = 'none' | 'due'

/** A usage endpoint answer that was not a success, with the wait a 429 asked for. */
class EndpointError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | undefined) {
    super(`HTTP ${status}`)
  }
}

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/**
 * What the hooks share: the last reading, the tracks kept in the store, the stored on/off setting with
 * whether a drawing of it stands, the last timer error, and the per-model limits with the time of their
 * last read and its last error.
 */
type State = {
  limits: readonly SessionRateLimit[]
  tracks: Tracks
  enabled: boolean
  drawn: boolean
  lastError?: string
  scoped: readonly SessionRateLimit[]
  scopedReadAt?: number
  scopedError?: string
  noted: Record<string, Noted>
  pending: string[]
}

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

/**
 * Queues a note for the model about each level a limit passed for the first time in this session's
 * cycle. Only the highest new level is told; the next tool result or prompt of the main loop carries it.
 */
function queueNotes(state: State, now: number): void {
  for (const limit of state.limits) {
    const { noted, levels } = noteLevels(state.noted[limit.kind], limit)
    state.noted[limit.kind] = noted
    const top = levels.at(0)
    if (top !== undefined) state.pending.push(modelNoteText(limit, top, now))
  }
}

/** A tool result with the notes after its own context texts, so the model reads them right after it. */
function withNotes<R extends { context?: readonly string[] }>(r: R, notes: readonly string[]): R {
  return { ...r, context: [...(r.context ?? []), ...notes] }
}

/** The queued notes, once: the queue is empty afterwards. */
function takeNotes(state: State): string[] {
  return state.pending.splice(0)
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
 * Reads the on/off setting from the store, which every window shares, so a change made in another
 * window applies here at the next hook that acts on it.
 */
async function readSettings($: EngineInterface, state: State): Promise<void> {
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
}

/** Drops everything the mod drew: the sidebar section, the status line and an open pane. */
async function clearDrawings($: EngineInterface): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'limit-watch', key: 'limits' })
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.status(undefined)
  if ((await $.ui.panes()).some(pane => pane.id === PANE_ID)) await $.ui.close({ id: PANE_ID })
}

/**
 * Reads the per-model weekly limits from the usage endpoint. A session with no first-party OAuth
 * credential (an API key, a gateway, a third-party provider) has none to read.
 */
async function fetchScoped($: EngineInterface): Promise<SessionRateLimit[]> {
  const auth = await $.session.authorize()
  if (auth === null || auth.kind !== 'bearer') return []
  const response = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': USAGE_BETA } })
  if (!response.ok) throw new EndpointError(response.status, response.headers['retry-after'])
  const limits = scopedLimits(JSON.parse(response.text))
  if (limits === undefined) throw new Error('the answer has no limits list')
  return limits
}

/**
 * Reads the per-model limits again when `read` asks for it and the account's last read, shared through
 * the store, is old enough. Every sample first takes what the store holds, so a read another session
 * made, or one from before a reload, shows here without a request of its own. The attempt is stored
 * before the request goes, so the other sessions skip theirs.
 */
async function refreshScoped($: EngineInterface, state: State, now: number, read: ScopedRead): Promise<void> {
  const shared = parseScopedRecord(await $.store.get(SCOPED_KEY))
  if (shared !== undefined) {
    state.scoped = shared.limits
    state.scopedReadAt = shared.readAt
  }
  if (read === 'none' || !isScopedDue(shared, now, SCOPED_MS)) return
  await $.store.set(SCOPED_KEY, { ...shared, at: now, limits: state.scoped, until: undefined })
  try {
    const limits = await fetchScoped($)
    state.scoped = limits
    state.scopedReadAt = now
    state.scopedError = undefined
    await $.store.set(SCOPED_KEY, { at: now, readAt: now, limits })
  } catch (err) {
    await scopedFailed($, state, now, err)
  }
}

/**
 * A failed read is logged once per error text. A 429 keeps the last reading and stores the wait the
 * endpoint asked for, so no session of the account asks again before it ends. Any other failure drops
 * the per-model limits, so an old reading is never shown as the current one; the limits
 * `$.session.usage()` reports stay.
 */
async function scopedFailed($: EngineInterface, state: State, now: number, err: unknown): Promise<void> {
  const text = err instanceof Error ? err.message : String(err)
  if (err instanceof EndpointError && err.status === 429) {
    const until = now + retryAfterMs(err.retryAfter, now)
    await $.store.set(SCOPED_KEY, { at: now, readAt: state.scopedReadAt, limits: state.scoped, until })
    if (text !== state.scopedError) $.ui.log(`cannot read the per-model limits: ${text}; ${keptText(state, until, now)}`)
  } else {
    state.scoped = []
    state.scopedReadAt = undefined
    await $.store.set(SCOPED_KEY, { at: now, limits: [] })
    if (text !== state.scopedError) $.ui.log(`cannot read the per-model limits: ${text}`)
  }
  state.scopedError = text
}

/** What stays during a 429 wait, and when the next read goes. */
function keptText(state: State, until: number, now: number): string {
  const next = `the next read is at ${clockText(until, now)}`
  if (state.scopedReadAt === undefined || state.scoped.length === 0) return next
  return `the reading of ${clockText(state.scopedReadAt, now)} stays, and ${next}`
}

/**
 * Reads the limits, records a sample, raises new warnings, stores the tracks and redraws. The stored
 * tracks are read again first, so a warning another session of the account wrote is not repeated.
 * The stored on/off setting is read first too: while it says off nothing is sampled and what stands
 * is cleared, so a watcher another window turned off stops here as well.
 */
async function sample($: EngineInterface, state: State, read: ScopedRead): Promise<void> {
  await readSettings($, state)
  if (!state.enabled) {
    if (state.drawn) await clearDrawings($)
    state.drawn = false
    return
  }
  const usage = await $.session.usage()
  const now = await $.clock.now()
  await refreshScoped($, state, now, read)
  state.limits = [...usage.rateLimits, ...state.scoped]
  state.tracks = record(state.tracks, state.limits, now)
  state.tracks = mergeWarned(state.tracks, parseTracks(await $.store.get(TRACKS_KEY)) ?? {})
  warn($, state, now)
  queueNotes(state, now)
  await $.store.set(TRACKS_KEY, state.tracks)
  // The sidebar takes the reading while it is open; otherwise the status line shows it, as before.
  $.ui.status((await toSidebar($, state, now)) ? undefined : statusLine(state.limits, state.tracks, now))
  $.ui.invalidate('ui.render')
  state.drawn = true
}

/**
 * Samples and logs a failed read instead of throwing: a timer sample has no hook to fail, and a failed
 * first read must not stop the hook that arms the timer. The same error is logged once.
 */
async function sampleOrLog($: EngineInterface, state: State, read: ScopedRead): Promise<void> {
  try {
    await sample($, state, read)
    state.lastError = undefined
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    if (text !== state.lastError) $.ui.log(`cannot read the usage limits: ${text}`)
    state.lastError = text
  }
}

/**
 * The /limit-watch command. A bare run opens or closes the pane. `on` and `off` stop and start the
 * whole watcher; the setting is stored, so it holds for every window at its next hook that acts on it.
 */
async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on') {
    await $.store.set(ENABLED_KEY, true)
    state.enabled = true
    await sample($, state, 'due')
    if (!state.enabled) return OFF_TEXT
    return 'on. /limit-watch opens the pane.'
  }
  if (word === 'off') {
    await $.store.set(ENABLED_KEY, false)
    state.enabled = false
    if (state.drawn) await clearDrawings($)
    state.drawn = false
    return OFF_TEXT
  }
  if (word !== '') return USAGE
  if (!state.enabled) return OFF_TEXT
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
  if (isOpen) {
    await $.ui.close({ id: PANE_ID })
    return 'pane closed'
  }
  await sample($, state, 'due')
  if (!state.enabled) return OFF_TEXT
  await $.ui.open({ id: PANE_ID, title: 'Usage limits', rows: Math.max(2, state.limits.length * ROWS_PER_LIMIT) })
  return 'pane open. /limit-watch closes it.'
}

/**
 * The tool's answer: a new sample, so the model reads the limits as they stand now. The usage endpoint
 * keeps the account's interval here too, and a reading kept through a failed read names its time. A
 * watcher turned off samples nothing, here as on its timer.
 */
async function serveTool($: EngineInterface, state: State): Promise<string> {
  await sample($, state, 'due')
  if (!state.enabled) return TOOL_OFF
  const now = await $.clock.now()
  const text = toolText(state.limits, state.tracks, now)
  if (state.scopedError === undefined || state.scopedReadAt === undefined || state.scoped.length === 0) return text
  return `${text}\nThe per-model limits are as read at ${clockText(state.scopedReadAt, now)}; the last read of the usage endpoint failed: ${state.scopedError}.`
}

export const register: Register = on => {
  const state: State = { limits: [], tracks: {}, enabled: true, drawn: false, scoped: [], noted: {}, pending: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const stored = parseTracks(await $.store.get(TRACKS_KEY))
    if (stored === undefined) $.ui.log('the stored samples have an unknown shape, so the pace starts over')
    state.tracks = stored ?? {}
    await readSettings($, state)
    await $.command.register({
      name: 'limit-watch',
      description: 'Open or close the usage limits pane, or turn the watcher off and on (limit-watch)',
      argumentHint: '[on | off]',
      immediate: true,
    })
    // Declared at the start, so the tool list the prompt cache holds does not change mid-session.
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: { type: 'object', properties: {} } })
    // A -p run draws nothing, so only an interactive session samples on a timer. The timer is armed
    // before the first read, so a first read that fails does not leave the session without one. The
    // idle timer never reads the usage endpoint; only a session's own activity does.
    if (e.isInteractive) $.clock.every(TICK_MS, () => void sampleOrLog($, state, 'none'))
    if (state.enabled) await sampleOrLog($, state, 'due')
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await sample($, state, 'due')
    return r
  })

  // A plugin's tool waits behind ToolSearch by default; this one is listed, and it reads only, so it asks no approval.
  on('tool.describe', { tool: /^mcp__limit-watch__limits$/ }, async (_, e, next) => ({ ...(await next(e)), isDeferred: false }))
  on('tool.check', { tool: /^mcp__limit-watch__limits$/ }, async () => ({ decision: 'allow' as const }))
  on('tool.call', { tool: /^mcp__limit-watch__limits$/ }, async $ => ({ result: await serveTool($, state) }))

  // A passed level reaches the main loop's model at its next tool result, in the middle of its work, or
  // with the next prompt when no tool runs first. A subagent's result does not take it: the main loop
  // decides whether to stop.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || state.pending.length === 0) return r
    return withNotes(r, takeNotes(state))
  })
  on('prompt.submit', async ($, e, next) => {
    const notes = takeNotes(state)
    return next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'limit-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

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
