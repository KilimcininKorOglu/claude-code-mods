import type { EngineInterface, Register, TurnUsage } from 'claude-code'
import { priceOf, responseUsd, writeUsd } from './pricing.ts'
import {
  AUTO_WARM_MS,
  DEFAULT_WINDOW_MS,
  MIN_PING_MS,
  PING_AFTER_MS,
  card,
  coldPingText,
  fmtDuration,
  fmtTok,
  fmtUsd,
  freshState,
  isColdWrite,
  isWarmPing,
  parseWarmArgs,
  resetForClear,
  seedFromResume,
  statusText,
  type State,
} from './warm.ts'

const PING_PROMPT = 'Reply with the single word: warm'
const KEY_ALWAYS = 'always'
const DEADLINE = 'deadline:'
const EVERY = 'every:'
/** Another session's window that ended this long ago is not coming back. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000

// The window and its ping period belong to the session that armed them, so a
// second session never inherits them and cannot turn them off. The always
// switch is global.
function deadlineKey(s: State): string {
  return DEADLINE + s.sid
}

function everyKey(s: State): string {
  return EVERY + s.sid
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

/**
 * Writes the window's state into the shared sidebar and answers whether it took it. A closed sidebar,
 * and a sidebar mod that is not installed, both answer false, so the status line is drawn instead.
 */
async function toSidebar($: EngineInterface, text: string | undefined): Promise<boolean> {
  try {
    if (text === undefined) {
      await $.sidebar.clear(SECTION)
      return await $.sidebar.isOpen()
    }
    return await $.sidebar.set({ ...SECTION, title: 'cache window', lines: [{ text }], until: 'session', order: 20 })
  } catch {
    // The sidebar mod is not installed.
    return false
  }
}

async function showStatusAt($: EngineInterface, s: State, now: number): Promise<void> {
  const text = statusText(s, now)
  $.ui.status((await toSidebar($, text)) ? undefined : text)
}

async function showStatus($: EngineInterface, s: State): Promise<void> {
  await showStatusAt($, s, await $.clock.now())
}

/**
 * Deletes this session's ended window, and the windows of other sessions that
 * ended more than a week ago. A newer window of another session is left alone,
 * because that session may still resume and renew it.
 */
async function prune($: EngineInterface, s: State, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(DEADLINE)) continue
    const deadline = await $.store.get(key)
    const grace = key === deadlineKey(s) ? 0 : STALE_MS
    if (typeof deadline === 'number' && deadline + grace > now) continue
    await $.store.delete(key)
    await $.store.delete(EVERY + key.slice(DEADLINE.length))
  }
}

async function restore($: EngineInterface, s: State, now: number): Promise<void> {
  const deadline = await $.store.get(deadlineKey(s))
  const every = await $.store.get(everyKey(s))
  s.deadline = typeof deadline === 'number' && deadline > now ? deadline : 0
  s.every = typeof every === 'number' && every >= MIN_PING_MS ? every : PING_AFTER_MS
  s.always = (await $.store.get(KEY_ALWAYS)) === true
}

async function stop($: EngineInterface, s: State, why: string | null, forgetAlways = false): Promise<void> {
  s.deadline = 0
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
  if (!s.deadline) return
  const now = await $.clock.now()
  if (now >= s.deadline) return stop($, s, null)
  if (s.lastRequestAt && !s.compacted) {
    const delay = Math.max(1000, s.lastRequestAt + s.every - now)
    s.pending = $.clock.after(delay, () => { void runPing($, s) })
  }
  await showStatusAt($, s, now)
}

async function ping($: EngineInterface, s: State): Promise<void> {
  s.pending = null
  if (!s.deadline) return
  const now = await $.clock.now()
  // The window ended, or a request since the timer was set moved the ping later.
  if (now >= s.deadline || now - s.lastRequestAt < s.every - 1000) return arm($, s)
  let reply
  try {
    reply = await $.model.fork({ prompt: PING_PROMPT })
  } catch (err) {
    return stop($, s, `the ping failed, ${errorText(err)}`)
  }
  if (reply === null) return stop($, s, 'the engine did not send the ping; the snapshot was cold or the API call failed')
  const price = priceOf(s.model)
  const usd = price ? responseUsd(reply.usage, price) : null
  s.lastPing = { read: reply.usage.cache_read_input_tokens, write: reply.usage.cache_creation_input_tokens, usd }
  if (!isWarmPing(reply.usage)) return stop($, s, coldPingText(reply.usage, usd))
  s.lastRequestAt = now
  await arm($, s)
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
  s.deadline = await $.clock.now() + windowMs
  s.stopped = null
  await $.store.set(deadlineKey(s), s.deadline)
  if (every === PING_AFTER_MS) await $.store.delete(everyKey(s))
  else await $.store.set(everyKey(s), every)
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
      return statusText(s, await $.clock.now()) ?? 'off'
    case 'off': {
      const wasAlways = s.always
      await stop($, s, null, true)
      return wasAlways ? 'off, and no longer arms itself at session start' : 'off'
    }
    case 'always':
      s.always = true
      await $.store.set(KEY_ALWAYS, true)
      await startWindow($, s, DEFAULT_WINDOW_MS, PING_AFTER_MS)
      return `always on: every session starts with a ${fmtDuration(DEFAULT_WINDOW_MS)} window; /cache-warm off turns it off for good`
    case 'arm':
      await startWindow($, s, command.window, command.every)
      return `on for ${fmtDuration(command.window)}, a ping ${fmtDuration(command.every)} after each idle stretch keeps the cache read, not re-written`
  }
}

async function clearSession($: EngineInterface, s: State): Promise<void> {
  await stop($, s, null)
  resetForClear(s)
  s.sid = await $.session.id()
  if (s.always) await startWindow($, s, DEFAULT_WINDOW_MS, PING_AFTER_MS)
}

/** Scores a turn that re-wrote the context, and keeps the cache warm after it. */
async function measure($: EngineInterface, s: State, u: TurnUsage, now: number): Promise<void> {
  if (u.model) s.model = u.model
  const previous = s.ctx
  const write = u.cache_creation_input_tokens
  // A turn's usage sums its responses, so a ten-step turn counts the context ten
  // times; the engine's live window figure is the context, the sum only a fallback.
  const live = (await $.session.usage()).context.tokens
  s.ctx = live && live > 0 ? live : u.input_tokens + u.cache_read_input_tokens + write
  if (!isColdWrite(previous, write)) return
  const usd = writeUsd(write, priceOf(s.model))
  s.coldWrites.push({ tokens: write, usd })
  if (s.deadline >= now + AUTO_WARM_MS) return
  await startWindow($, s, AUTO_WARM_MS, s.every)
  $.ui.log(`cold write of ${fmtTok(write)} tokens paid (${fmtUsd(usd)}). Keeping the cache warm for ${fmtDuration(AUTO_WARM_MS)}; /cache-warm off stops it.`)
}

async function afterTurn($: EngineInterface, s: State, durationMs: number, usage: TurnUsage | undefined): Promise<void> {
  const now = await $.clock.now()
  // turn.step stamps each request; when no step of this turn did, the turn's end is the floor.
  if (now - s.lastRequestAt > durationMs) s.lastRequestAt = now
  s.compacted = false
  if (usage) await measure($, s, usage, now)
  await arm($, s)
}

export const register: Register = on => {
  const s = freshState()

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    s.sid = await $.session.id()
    const now = await $.clock.now()
    await prune($, s, now)
    await restore($, s, now)
    // Always means a fresh default window every session, whatever the last one left behind.
    if (s.always) await startWindow($, s, DEFAULT_WINDOW_MS, PING_AFTER_MS)
    const live = (await $.session.usage()).context.tokens
    if (live) s.ctx = live
    await registerCommands($)
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
    if (line) $.ui.log(line)
    return r
  })

  on('command.run', { command: 'cache-warm' }, async ($, e) => ({ text: await warmCommand($, s, String(e.args ?? '')) }))

  on('command.run', { command: 'cache-status' }, async $ => ({ text: card(s, await $.clock.now()) }))

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) s.lastRequestAt = await $.clock.now()
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
