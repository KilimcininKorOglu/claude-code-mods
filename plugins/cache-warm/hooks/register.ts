import type { EngineInterface, Register, TurnUsage } from 'claude-code'
import { responseUsd, writeUsd, type Usage } from './pricing.ts'
import {
  AUTO_WARM_MS,
  MIN_PING_MS,
  PING_AFTER_MS,
  card,
  coldPingText,
  coldWriteShort,
  eventShort,
  fmtDuration,
  fmtTok,
  fmtUsd,
  freshState,
  hasWindow,
  idleText,
  isColdWrite,
  isOver,
  isWarmPing,
  parseWarmArgs,
  pingRecordOf,
  priceNow,
  resetForClear,
  seedFromResume,
  statusText,
  transcriptPath,
  TTL_MS,
  unsentText,
  windowLine,
  type Line,
  type PingRecord,
  type State,
} from './warm.ts'

const PING_PROMPT = 'Reply with the single word: warm'
const KEY_ALWAYS = 'always'
const DEADLINE = 'deadline:'
const EVERY = 'every:'
const REQUEST = 'request:'
const LAST = 'last:'

/** How often a running window's line is drawn again, so its minutes count down between turns and pings. */
const REDRAW_MS = 60_000

// The window and its ping period belong to the session that armed them, so a
// second session never inherits them and cannot turn them off. The always
// switch is global.
function deadlineKey(s: State): string {
  return DEADLINE + s.sid
}

function everyKey(s: State): string {
  return EVERY + s.sid
}

/** The session's last main-loop request, kept for a module loaded into the running conversation. */
function requestKey(s: State): string {
  return REQUEST + s.sid
}

/** The session's last ping or turn read, kept so a reloaded module draws it again. */
function lastKey(s: State): string {
  return LAST + s.sid
}

/** Records the last request that read the cache, in memory and in the store. */
async function keepLastRead($: EngineInterface, s: State, record: PingRecord): Promise<void> {
  s.lastRead = record
  await $.store.set(lastKey(s), record)
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function disarm(s: State): void {
  s.pending?.cancel()
  s.pending = null
}

/** The section this mod owns in the shared sidebar. */
const SECTION = { consumer: 'cache-warm', key: 'window' }

/** Writes one transcript line and keeps a short form of it for the sidebar's second line. */
function logEvent($: EngineInterface, s: State, text: string, short: Line): void {
  $.ui.log(text)
  s.event = short
}

/**
 * Writes the window's state into the shared sidebar and answers whether it took it. The section also
 * carries the last transcript line under the state, faint: the first line says how long the window
 * holds, the second what the mod last did. A closed sidebar, and a sidebar mod that is not installed,
 * both answer false, so the status line is drawn instead.
 */
async function toSidebar($: EngineInterface, s: State, line: Line): Promise<boolean> {
  try {
    const lines = [line, ...(s.event === undefined ? [] : [s.event])]
    return await $.sidebar.set({ ...SECTION, title: 'cache window', lines, until: 'session', order: 20 })
  } catch {
    // The sidebar mod is not installed.
    return false
  }
}

/**
 * Draws the window's state. The sidebar keeps a line either way: the window's own line, or the faint
 * idle line while none runs, so the section is never a snapshot of a window that ended. The status line
 * is unchanged: with no window and no stop reason it carries nothing.
 */
async function showStatusAt($: EngineInterface, s: State, now: number): Promise<void> {
  const taken = await toSidebar($, s, windowLine(s, now))
  $.ui.status(taken ? undefined : statusText(s, now))
}

async function showStatus($: EngineInterface, s: State): Promise<void> {
  await showStatusAt($, s, await $.clock.now())
}

/**
 * Deletes every session's ended window. A resumed session reads an ended window
 * as no window (`restore`), so keeping one only grows the store; a window still
 * running is left alone.
 */
async function prune($: EngineInterface, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(DEADLINE)) continue
    const deadline = await $.store.get(key)
    if (typeof deadline === 'number' && deadline > now) continue
    await $.store.delete(key)
    await $.store.delete(EVERY + key.slice(DEADLINE.length))
  }
}

/** The time a stored request or read record was made, or undefined for a value of another shape. */
function storedAt(key: string, value: unknown): number | undefined {
  if (key.startsWith(REQUEST)) return typeof value === 'number' ? value : undefined
  return pingRecordOf(value)?.at
}

/**
 * Deletes every other session's last request time and last read that are older than the cache, which is
 * gone by then. This session's own stay: the request's age is what tells the seed the cache is gone, and
 * the next turn rewrites both.
 */
async function pruneRequests($: EngineInterface, s: State, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!(key.startsWith(REQUEST) || key.startsWith(LAST)) || key === requestKey(s) || key === lastKey(s)) continue
    const at = storedAt(key, await $.store.get(key))
    if (at === undefined || now - at >= TTL_MS) await $.store.delete(key)
  }
}

async function restore($: EngineInterface, s: State, now: number): Promise<void> {
  const deadline = await $.store.get(deadlineKey(s))
  const every = await $.store.get(everyKey(s))
  s.deadline = typeof deadline === 'number' && deadline > now ? deadline : 0
  s.every = typeof every === 'number' && every >= MIN_PING_MS ? every : PING_AFTER_MS
  s.always = (await $.store.get(KEY_ALWAYS)) === true
  s.lastRead = pingRecordOf(await $.store.get(lastKey(s)))
}

async function stop($: EngineInterface, s: State, why: string | null, forgetAlways = false): Promise<void> {
  s.deadline = 0
  s.endless = false
  s.every = PING_AFTER_MS
  s.stopped = why
  disarm(s)
  await $.store.delete(deadlineKey(s))
  await $.store.delete(everyKey(s))
  if (forgetAlways) {
    s.always = false
    await $.store.delete(KEY_ALWAYS)
  }
  await showStatus($, s)
}

/** Schedules the next ping one period after the last request. */
async function arm($: EngineInterface, s: State): Promise<void> {
  disarm(s)
  const now = await $.clock.now()
  if (isOver(s, now)) {
    // A window that ran out of time is armed again by the next message, as long as this one was. A
    // window the ping stopped is not: the cache is gone there, and the cold write of the next message
    // arms its own window. The endless loop never reaches this.
    const again = { window: s.window, every: s.every }
    await stop($, s, null)
    s.renew = again
    return showStatusAt($, s, now)
  }
  if (hasWindow(s) && s.lastRequestAt && !s.compacted) {
    const delay = Math.max(1000, s.lastRequestAt + s.every - now)
    s.pending = $.clock.after(delay, () => { void runPing($, s) })
  }
  // A session with no window draws too, so the pane follows the state instead of holding the last one.
  await showStatusAt($, s, now)
}

/**
 * Records the ping's answer and schedules the next one. A ping that found the cache gone stops a window
 * with an end, because the write it paid for is the last thing that window wanted. The endless loop of
 * `always` carries on instead: that write is the new cache, and the next ping keeps it.
 */
async function settlePing($: EngineInterface, s: State, usage: Usage, now: number): Promise<void> {
  const price = priceNow(s)
  const usd = price ? responseUsd(usage, price) : null
  await keepLastRead($, s, { kind: 'ping', read: usage.cache_read_input_tokens, write: usage.cache_creation_input_tokens, usd, at: now })
  if (!isWarmPing(usage)) {
    if (!s.endless) return stop($, s, coldPingText(usage, usd))
    const write = usage.cache_creation_input_tokens
    s.coldWrites.push({ tokens: write, usd })
    logEvent($, s, `the ping found the cache gone and re-wrote ${fmtTok(write)} tokens (${fmtUsd(usd)}); always keeps the loop running. /cache-warm off stops it.`, coldWriteShort(write, usd))
  }
  s.lastRequestAt = now
  await arm($, s)
}

async function ping($: EngineInterface, s: State): Promise<void> {
  s.pending = null
  if (!hasWindow(s)) return
  const now = await $.clock.now()
  // The window ended, or a request since the timer was set moved the ping later.
  if (isOver(s, now) || now - s.lastRequestAt < s.every - 1000) return arm($, s)
  let reply
  try {
    reply = await $.model.fork({ prompt: PING_PROMPT })
  } catch (err) {
    return stop($, s, `the ping failed, ${errorText(err)}`)
  }
  // A reply without text still read the cache, so it is scored as a ping; every other unanswered fork stops.
  if (!reply.isAnswered && reply.reason !== 'empty-reply') return stop($, s, unsentText(reply))
  await settlePing($, s, reply.usage, now)
}

async function runPing($: EngineInterface, s: State): Promise<void> {
  try {
    await ping($, s)
  } catch (err) {
    await stop($, s, `the ping step failed, ${errorText(err)}`)
  }
}

async function startWindow($: EngineInterface, s: State, windowMs: number, every: number): Promise<void> {
  s.every = every
  s.window = windowMs
  s.renew = null
  s.deadline = await $.clock.now() + windowMs
  s.stopped = null
  await $.store.set(deadlineKey(s), s.deadline)
  if (every === PING_AFTER_MS) await $.store.delete(everyKey(s))
  else await $.store.set(everyKey(s), every)
  await arm($, s)
}

/**
 * Starts the endless loop of `always`: a ping every period until `/cache-warm off`, with no end time.
 * It writes no per-session deadline, so the switch stays one global key that every session of every
 * project reads at its start.
 */
async function startEndless($: EngineInterface, s: State): Promise<void> {
  s.every = PING_AFTER_MS
  s.window = 0
  s.renew = null
  s.deadline = 0
  s.endless = true
  s.stopped = null
  await $.store.delete(deadlineKey(s))
  await $.store.delete(everyKey(s))
  await arm($, s)
}

async function registerCommands($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'cache-warm',
    description: 'Keep the prompt cache warm: bare for 6h, a window such as 90m, always, off, or status (cache-warm)',
    argumentHint: '[6h | 90m | always | off | status]',
    immediate: true,
  })
  await $.command.register({
    name: 'cache-status',
    description: 'Prompt cache state, cold price and this session\'s cold writes (cache-warm)',
    immediate: true,
  })
}

async function warmCommand($: EngineInterface, s: State, args: string): Promise<string> {
  const command = parseWarmArgs(args)
  switch (command.kind) {
    case 'error':
      return command.text
    case 'status':
      return statusText(s, await $.clock.now()) ?? idleText(s)
    case 'off': {
      const wasAlways = s.always
      s.renew = null
      await stop($, s, null, true)
      return wasAlways ? 'off, and no longer starts itself in any session' : 'off'
    }
    case 'always':
      s.always = true
      await $.store.set(KEY_ALWAYS, true)
      await startEndless($, s)
      return `always on: a ping every ${fmtDuration(PING_AFTER_MS)} with no end, in this session and in every later session of every project; /cache-warm off turns it off for good`
    case 'arm':
      await startWindow($, s, command.window, command.every)
      return `on for ${fmtDuration(command.window)}, a ping ${fmtDuration(command.every)} after each idle stretch keeps the cache read, not re-written`
  }
}

async function clearSession($: EngineInterface, s: State): Promise<void> {
  await stop($, s, null)
  resetForClear(s)
  s.sid = await $.session.id()
  if (s.always) await startEndless($, s)
}

/** The origins of a message the person sent themselves, which is what arms a window again. */
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']

/**
 * Arms the window again with the person's next message, as long as the one that ran out of time was and
 * with the same ping period. A message whose origin the engine does not name arms nothing, so a plugin's
 * own prompt never renews a window the person let end.
 */
async function renewWindow($: EngineInterface, s: State, kind: string | undefined): Promise<void> {
  const again = s.renew
  if (again === null || s.deadline || kind === undefined || !USER_ORIGINS.includes(kind)) return
  // The line is written before the window starts, so the sidebar's redraw already carries it.
  const text = `the ${fmtDuration(again.window)} window ran out; this message arms another one. /cache-warm off stops it.`
  logEvent($, s, text, eventShort(`window armed again for ${fmtDuration(again.window)}`))
  await startWindow($, s, again.window, again.every)
}

/** Scores a turn that re-wrote the context, and keeps the cache warm after it. */
async function measure($: EngineInterface, s: State, u: TurnUsage, now: number): Promise<void> {
  if (u.model) s.model = u.model
  // A turn's usage sums its requests, so this is what the whole turn read and cost.
  const price = priceNow(s)
  await keepLastRead($, s, { kind: 'turn', read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, usd: price ? responseUsd(u, price) : null, at: now })
  const previous = s.ctx
  const write = u.cache_creation_input_tokens
  // A turn's usage sums its responses, so a ten-step turn counts the context ten
  // times; the engine's live window figure is the context, the sum only a fallback.
  const live = (await $.session.usage()).context.tokens
  s.ctx = live && live > 0 ? live : u.input_tokens + u.cache_read_input_tokens + write
  if (!isColdWrite(previous, write)) return
  const usd = writeUsd(write, priceNow(s))
  s.coldWrites.push({ tokens: write, usd })
  // The endless loop already keeps this cache; a window with an end would only shorten it.
  if (s.endless || s.deadline >= now + AUTO_WARM_MS) return
  // The line is written before the window starts, so the sidebar's redraw already carries it.
  logEvent($, s, `cold write of ${fmtTok(write)} tokens paid (${fmtUsd(usd)}). Keeping the cache warm for ${fmtDuration(AUTO_WARM_MS)}; /cache-warm off stops it.`, coldWriteShort(write, usd))
  await startWindow($, s, AUTO_WARM_MS, s.every)
}

/**
 * Whether the session bills fast mode rates, as far as the settings say: `/fast` writes `fastMode`, and
 * `fastModePerSessionOptIn` starts every session with fast mode off whatever `fastMode` holds. Read at
 * each turn, because `/fast` can change it mid-session.
 */
async function readFast($: EngineInterface, s: State): Promise<void> {
  const settings = await $.settings.read() as { fastMode?: unknown; fastModePerSessionOptIn?: unknown }
  s.fast = settings.fastMode === true && settings.fastModePerSessionOptIn !== true
}

async function afterTurn($: EngineInterface, s: State, durationMs: number, usage: TurnUsage | undefined): Promise<void> {
  const now = await $.clock.now()
  await readFast($, s)
  // turn.step stamps each request; when no step of this turn did, the turn's end is the floor.
  if (now - s.lastRequestAt > durationMs) s.lastRequestAt = now
  await $.store.set(requestKey(s), s.lastRequestAt)
  s.compacted = false
  // The stop reason and the line under it belong to the window that ended: one turn later the pane
  // carries the idle line instead, and the reason stays in the transcript.
  if (s.stopped) {
    s.stopped = null
    s.event = undefined
  }
  // `always` runs until /cache-warm off, so a ping that failed stopped the loop for this turn alone:
  // the next turn starts it again. Without this the session keeps `always` stored while running no
  // loop, and the next cold write arms a 6h window in its place. A window the person armed by hand
  // holds, because it is a window of its own.
  if (s.always && !hasWindow(s)) await startEndless($, s)
  if (usage) await measure($, s, usage, now)
  await arm($, s)
}

/**
 * Stamps a main-loop request. The request writes the cache a compaction dropped, and it sets the ping
 * when none is pending: a turn's end sets it otherwise, so the first turn of a session, or the first
 * after /clear or a compaction, would run one long tool call past the hour with no ping. A pending ping
 * reads the newest request when it fires and moves itself later, so a later step sets nothing.
 */
async function stampRequest($: EngineInterface, s: State): Promise<void> {
  s.lastRequestAt = await $.clock.now()
  s.compacted = false
  if (s.pending === null && hasWindow(s)) await arm($, s)
}

/**
 * The time of the last request of a conversation this module did not see: a reloaded module starts with
 * no request time, and `always` would wait for the first turn to arm its ping. Each turn's end keeps that
 * time in the store; only a session with none kept yet (one that ran an older version) reads the last
 * write of its transcript, which a reload's own line moves to the reload. Only a cache that is still warm
 * is taken, so a reload never pays for a cold ping the next message would pay anyway.
 */
async function seedLastRequest($: EngineInterface, s: State, now: number): Promise<void> {
  const kept = await $.store.get(requestKey(s))
  if (typeof kept !== 'number') return seedFromTranscript($, s, now)
  if (now - kept < TTL_MS) s.lastRequestAt = kept
}

/**
 * The transcript lies under the directory the session started in, which a shell `cd` does not move
 * (measured: a module reloaded after `cd sub` looked under `sub` and found nothing).
 */
async function seedFromTranscript($: EngineInterface, s: State, now: number): Promise<void> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  const path = transcriptPath(configDir, await $.session.root(), s.sid)
  try {
    if (!(await $.fs.exists(path))) {
      $.ui.log(`the last request time of this session was not read: ${path} does not exist`)
      return
    }
    const { mtimeMs } = await $.fs.stat(path)
    if (now - mtimeMs < TTL_MS) s.lastRequestAt = mtimeMs
  } catch (err) {
    $.ui.log(`the last request time of this session was not read from ${path}: ${errorText(err)}`)
  }
}

export const register: Register = on => {
  const s = freshState()

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    s.sid = await $.session.id()
    const now = await $.clock.now()
    await prune($, now)
    await pruneRequests($, s, now)
    await restore($, s, now)
    await readFast($, s)
    // A reload gets no classic.SessionStart, and a ping can come before the first turn names the model.
    s.model ??= await $.session.model()
    const live = (await $.session.usage()).context.tokens
    if (live) s.ctx = live
    // A loaded conversation this module has not seen a request of: a reload, or an update mid-session.
    if (live && !s.lastRequestAt) await seedLastRequest($, s, now)
    // The always switch is one global key, so every session of every project starts the endless loop,
    // whatever the last window of this session left behind.
    if (s.always) await startEndless($, s)
    await registerCommands($)
    // A -p run draws nothing, so only an interactive session redraws on a timer, and only while a window runs.
    if (e.isInteractive) $.clock.every(REDRAW_MS, () => { if (hasWindow(s)) void showStatus($, s) })
    await showStatus($, s)
    return r
  })

  // /clear arrives only through the classic seam, and a resume brings the
  // fields Claude Code computes for settings hooks.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id !== undefined) return r
    if (e.source === 'clear') {
      await clearSession($, s)
      return r
    }
    const line = seedFromResume(s, e, await $.clock.now())
    s.model ??= await $.session.model()
    if (line) logEvent($, s, line, eventShort(line))
    return r
  })

  // Only the origin is read; the prompt text passes through untouched.
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    await renewWindow($, s, (e.origin as { kind?: string } | undefined)?.kind)
    return r
  })

  on('command.run', { command: 'cache-warm' }, async ($, e) => ({ text: await warmCommand($, s, String(e.args ?? '')) }))

  on('command.run', { command: 'cache-status' }, async $ => ({ text: card(s, await $.clock.now()) }))

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await stampRequest($, s)
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await afterTurn($, s, e.durationMs, e.usage)
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    s.compacted = true
    s.ctx = 0
    disarm(s)
    await showStatus($, s)
    return r
  })
}
