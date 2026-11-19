import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, SessionAuthorization, SessionRateLimit, SessionStartInput, TurnCompleteInput, UiPane } from 'claude-code'

tier('user')

const T0 = Date.parse('2026-09-18T12:00:00Z')
const RESET = '2026-09-18T15:00:00Z'
const session: SessionStartInput = { surface: null, isInteractive: false, cwd: '/work' }
const turn = (agentId?: string): TurnCompleteInput => ({
  answer: 'done',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  agentId,
})
const run: CommandRunInput = {
  command: 'limit-watch',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
}

type World = {
  logs: string[]
  statuses: (string | undefined)[]
  panes: UiPane[]
  /** The tools the mod declared. */
  tools: string[]
  setLimits: (l: SessionRateLimit[]) => void
  /** How many of the next usage reads fail. */
  failUsage: number
  clock: MockClock
  /** What the store holds; another session writes here too. */
  store: Record<string, unknown>
  /** The session's credential: null on an API key or a gateway, as the engine answers there. */
  auth: SessionAuthorization
  /** The usage endpoint's status and body, and the requests it received. */
  usage: { status: number; body: string; retryAfter?: string }
  fetches: { url: string; auth?: string; beta?: string }[]
}

/** The usage endpoint's answer as measured on 2026-11-12, trimmed to the parts the mod reads. */
const usageBody = (fable: number): string =>
  JSON.stringify({
    five_hour: { utilization: 52 },
    limits: [
      { kind: 'session', group: 'session', percent: 52, resets_at: RESET, scope: null, is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 33, resets_at: '2026-09-20T00:00:00Z', scope: null, is_active: false },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: fable,
        resets_at: '2026-09-20T00:00:00Z',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
        is_active: false,
      },
    ],
  })

/** Answers the credential and the usage endpoint from the world's fields, and records each request. */
function seatEndpoint(on: On, w: World): void {
  on('session.authorize', () => ({ value: w.auth }))
  on('http.fetch', (_, e) => {
    w.fetches.push({ url: e.url, auth: e.init?.auth, beta: e.init?.headers?.['anthropic-beta'] })
    const headers: Record<string, string> = w.usage.retryAfter === undefined ? {} : { 'retry-after': w.usage.retryAfter }
    return { value: { status: w.usage.status, ok: w.usage.status < 300, headers, text: w.usage.body } }
  })
}

function world(on: On, store: Record<string, unknown> = {}): World {
  const endpoint = { auth: null, usage: { status: 200, body: usageBody(25) }, fetches: [] }
  const w: World = { logs: [], statuses: [], panes: [], tools: [], setLimits: () => undefined, failUsage: 0, clock: mock.clock(on, { now: T0 }), store: { ...store }, ...endpoint }
  seatEndpoint(on, w)
  let limits: SessionRateLimit[] = []
  w.setLimits = l => {
    limits = l
  }
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    w.tools.push(e.name)
    return { value: { tool: `mcp__limit-watch__${e.name}` } }
  })
  on('tool.describe', (_, e) => ({ description: e.description }))
  on('session.usage', () => {
    if (w.failUsage > 0) {
      w.failUsage -= 1
      throw new Error('usage down')
    }
    return { value: { startedAt: 0, context: { window: 200_000 }, rateLimits: limits } }
  })
  on('ui.log', (_, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_, e) => {
    w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  return w
}

const fiveHour = (percentUsed: number, resetsAt = RESET): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt })

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

/** The sections the sidebar took; `open` says whether it takes them at all, `cleared` lists the drops. */
type Bar = { open: boolean; sections: { title: string; lines: { text: string; kind?: string }[] }[]; cleared?: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const section = e as unknown as { title: string; lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ title: section.title, lines: section.lines })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    const drop = e as unknown as { consumer: string; key: string }
    if (bar.cleared !== undefined) bar.cleared.push(`${drop.consumer}:${drop.key}`)
    return { value: undefined }
  })
}

describe('limit-watch', () => {
  test('pins a status line with every limit at session start', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23), { kind: 'seven_day', percentUsed: 8, resetsAt: '2026-09-20T00:00:00Z' }])
    await $.session.start(session)
    // The 7-day pace is the cycle's own average, so it needs no samples: 8% in 5.5 days fills after the reset.
    expect(w.statuses.at(-1)).toBe('5h 23%, reset in 3h · 7d 8%, reset in 1d 12h · no limit fills before its reset')
  })

  test('says so when the account reports no limits', async ($, on) => {
    const w = world(on)
    await $.session.start(session)
    expect(w.statuses.at(-1)).toBe('no usage limits reported yet')
  })

  test('warns once per cycle when a limit passes a threshold', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(82)])
    await $.session.start(session)
    await $.turn.complete(turn())
    w.setLimits([fiveHour(84)])
    await $.turn.complete(turn())
    // The reset clock time is local, so only the time-zone independent parts are compared.
    const warnings = w.logs.filter(l => l.includes('passed'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('5-hour limit passed 80% (now 82%), resets ')
    expect(warnings[0]).toContain('(in 3h)')

    w.setLimits([fiveHour(81, '2026-09-18T20:00:00Z')])
    await $.turn.complete(turn())
    expect(w.logs.filter(l => l.includes('passed'))).toHaveLength(2)
  })

  test('keeps the warning state across sessions through the store', async ($, on) => {
    const stored = { five_hour: { resetsAt: RESET, samples: [{ at: T0 - 60_000, percent: 81 }], warned: [80] } }
    const w = world(on, { tracks: stored })
    w.setLimits([fiveHour(83)])
    await $.session.start(session)
    expect(w.logs.filter(l => l.includes('passed'))).toEqual([])
  })

  test('does not warn again about a threshold another session already warned about', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(70)])
    await $.session.start(session)
    // Another session of the same account passed 80% and stored its warning.
    w.store.tracks = { five_hour: { resetsAt: RESET, samples: [{ at: T0, percent: 81 }], warned: [80] } }
    w.setLimits([fiveHour(82)])
    await $.turn.complete(turn())
    expect(w.logs.filter(l => l.includes('passed'))).toEqual([])
    w.setLimits([fiveHour(96)])
    await $.turn.complete(turn())
    expect(w.logs.filter(l => l.includes('passed'))).toHaveLength(1)
  })

  test('reports a stored value of an unknown shape and starts over', async ($, on) => {
    const w = world(on, { tracks: { five_hour: 'broken' } })
    w.setLimits([fiveHour(10)])
    await $.session.start(session)
    expect(w.logs).toContain('the stored samples have an unknown shape, so the pace starts over')
    expect(w.statuses.at(-1)).toContain('5h 10%')
  })

  test('does not sample on a subagent turn', async ($, on) => {
    const w = world(on)
    await $.session.start(session)
    const before = w.statuses.length
    await $.turn.complete(turn('a1'))
    expect(w.statuses).toHaveLength(before)
  })

  test('the pane draws a block per limit with its bar, reset and pace, and no forecast', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(50)])
    await $.session.start(session)
    const tree = await $.ui.render({
      surface: 'terminal',
      component: 'Pane',
      requestId: 'limit-watch',
      props: {
        title: 'Usage limits',
        isFocused: false,
        bodyColumns: 22,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 12 },
        view: {},
      },
    })
    const text = JSON.stringify(tree)
    expect(text).toContain('5-hour limit')
    expect(text).toContain('50%')
    expect(text).toContain('██████████')
    expect(text).toContain('░░░░░░░░░░')
    expect(text).toContain('in 3h')
    expect(text).toContain('pace: measuring')
    expect(text).not.toContain('forecast')
  })

  test('the pane shows the measured pace and still no forecast', async ($, on) => {
    const stored = { five_hour: { resetsAt: RESET, samples: [{ at: T0 - 30 * 60_000, percent: 40 }], warned: [] } }
    const w = world(on, { tracks: stored })
    w.setLimits([fiveHour(60)])
    await $.session.start(session)
    const tree = await $.ui.render({
      surface: 'terminal',
      component: 'Pane',
      requestId: 'limit-watch',
      props: {
        title: 'Usage limits',
        isFocused: false,
        bodyColumns: 40,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 12 },
        view: {},
      },
    })
    const text = JSON.stringify(tree)
    expect(text).toContain('pace +40.0%/h over the last 30m')
    expect(text).not.toContain('forecast')
  })

  withSidebar('an open sidebar takes the reading and the status line stays empty', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    w.setLimits([fiveHour(23), { kind: 'seven_day', percentUsed: 88, resetsAt: '2026-09-20T00:00:00Z' }])
    await $.session.start(session)
    expect(bar.sections.at(-1)).toEqual({
      title: 'usage limits',
      lines: [
        { text: '5h 23%, reset in 3h', parts: [{ text: '5h ' }, { text: '23%', kind: 'ok' }, { text: ', reset in 3h', kind: 'dim' }] },
        { text: '7d 88%, reset in 1d 12h', parts: [{ text: '7d ' }, { text: '88%', kind: 'warn' }, { text: ', reset in 1d 12h', kind: 'dim' }] },
        // 88% after 5.5 days of the cycle is 2/3% an hour, so the last 12% take 18 hours.
        { text: '7d hits 100% in ~18h', parts: [{ text: '7d hits 100% in ' }, { text: '~18h', kind: 'warn' }] },
      ],
    })
    expect(w.statuses.at(-1)).toBe(undefined)
  })

  withSidebar('a limit over the top threshold is drawn red, and so is a limit already reached', async ($, on) => {
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    const w = world(on)
    w.setLimits([fiveHour(96)])
    await $.session.start(session)
    expect(bar.sections.at(-1)?.lines[0]).toEqual({
      text: '5h 96%, reset in 3h',
      parts: [{ text: '5h ' }, { text: '96%', kind: 'error' }, { text: ', reset in 3h', kind: 'dim' }],
    })
    w.setLimits([fiveHour(100)])
    await $.turn.complete(turn())
    expect(bar.sections.at(-1)?.lines.at(-1)).toEqual({ text: '5h limit reached', parts: [{ text: '5h ' }, { text: 'limit reached', kind: 'error' }] })
  })

  withSidebar('a tail with no single token to colour keeps its whole-line colour', async ($, on) => {
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    const w = world(on)
    w.setLimits([fiveHour(23), { kind: 'seven_day', percentUsed: 8, resetsAt: '2026-09-20T00:00:00Z' }])
    await $.session.start(session)
    expect(bar.sections.at(-1)?.lines.at(-1)).toEqual({ text: 'no limit fills before its reset', kind: 'ok' })
  })

  withSidebar('a closed sidebar leaves the status line as it was', async ($, on) => {
    const w = world(on)
    seatSidebar(on, { open: false, sections: [] })
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect(w.statuses.at(-1)).toContain('5h 23%')
  })

  test('a failed first read still arms the timer, which samples a minute later', async ($, on) => {
    const w = world(on)
    w.failUsage = 1
    w.setLimits([fiveHour(23)])
    await $.session.start({ ...session, isInteractive: true })
    expect(w.logs).toEqual(['cannot read the usage limits: no implementation for session.usage'])
    await w.clock.advance(60_000)
    expect(w.statuses.at(-1)).toContain('5h 23%')
  })

  test('/limit-watch opens the pane and closes it on the second run', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect((await $.command.run(run)).text).toContain('pane open')
    expect(w.panes.map(p => p.id)).toEqual(['limit-watch'])
    expect((await $.command.run(run)).text).toContain('pane closed')
    expect(w.panes).toEqual([])
  })

  test('off stops the sampling, clears the drawings and holds in the store', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start({ ...session, isInteractive: true })
    expect(w.statuses.at(-1)).toContain('5h 23%')
    expect((await $.command.run({ ...run, args: 'off' })).text).toContain('off')
    expect(w.statuses.at(-1)).toBe(undefined)
    expect(w.store.enabled).toBe(false)
    await $.turn.complete(turn())
    await w.clock.advance(60_000)
    expect(w.statuses.at(-1)).toBe(undefined)
  })

  test('on samples again at once and stores the setting', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    await $.command.run({ ...run, args: 'off' })
    expect((await $.command.run({ ...run, args: 'on' })).text).toContain('on')
    expect(w.store.enabled).toBe(true)
    expect(w.statuses.at(-1)).toContain('5h 23%')
  })

  withSidebar('off closes an open pane and drops the sidebar section', async ($, on) => {
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect((await $.command.run(run)).text).toContain('pane open')
    expect((await $.command.run({ ...run, args: 'off' })).text).toContain('off')
    expect(w.panes).toEqual([])
    expect(bar.cleared).toEqual(['limit-watch:limits'])
  })

  test('a watcher another window turned off stops here at the next hook that acts on it', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect(w.statuses.at(-1)).toContain('5h 23%')
    w.store.enabled = false
    await $.turn.complete(turn())
    expect(w.statuses.at(-1)).toBe(undefined)
    w.store.enabled = true
    await $.turn.complete(turn())
    expect(w.statuses.at(-1)).toContain('5h 23%')
  })

  test('the main loop model is told once per level at 80, 90 and 95%, at its next tool result or prompt', async ($, on) => {
    const w = world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
    const prompts: (readonly string[] | undefined)[] = []
    on('prompt.submit', (_, e) => {
      prompts.push(e.context)
      return { text: e.text, context: e.context }
    })
    const bash = async (agentId?: string) => (await $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)).context ?? []
    w.setLimits([fiveHour(70)])
    await $.session.start(session)
    expect(await bash()).toEqual([])
    // A jump past 80 and 90 tells only the highest level, in the middle of the work.
    w.setLimits([fiveHour(91)])
    await $.turn.complete(turn())
    expect(await bash('sub-1')).toEqual([])
    const notes = await bash()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain("limit-watch: the account's 5-hour limit passed 90% (now 91%), resets ")
    expect(notes[0]).toContain('Tell the user')
    expect(await bash()).toEqual([])
    w.setLimits([fiveHour(93)])
    await $.turn.complete(turn())
    expect(await bash()).toEqual([])
    // With no tool call first, the next prompt carries the note.
    w.setLimits([fiveHour(96)])
    await $.turn.complete(turn())
    await $.prompt.submit({ text: 'devam', origin: { kind: 'composer' }, wait: false })
    expect(prompts.at(-1)?.some(c => c.includes('5-hour limit passed 95% (now 96%)'))).toBe(true)
    // A new cycle tells the model again.
    w.setLimits([fiveHour(81, '2026-09-18T20:00:00Z')])
    await $.turn.complete(turn())
    expect((await bash()).join()).toContain('5-hour limit passed 80% (now 81%)')
  })

  test("another session's stored warning does not keep this session's model from its note", async ($, on) => {
    const stored = { five_hour: { resetsAt: RESET, samples: [{ at: T0 - 60_000, percent: 81 }], warned: [80] } }
    const w = world(on, { tracks: stored })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
    w.setLimits([fiveHour(83)])
    await $.session.start(session)
    expect(w.logs.filter(l => l.includes('passed'))).toEqual([])
    expect(((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).context ?? []).join()).toContain('5-hour limit passed 80% (now 83%)')
  })

  test('the model reads the limits as they stand now through a listed tool that asks no approval', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect(w.tools).toEqual(['limits'])
    const TOOL = 'mcp__limit-watch__limits'
    expect((await $.tool.describe({ tool: TOOL, description: 'd', provider: { kind: 'plugin', name: 'limit-watch' } } as never)).isDeferred).toBe(false)
    expect((await $.tool.check({ tool: TOOL, input: {} } as never)).decision).toBe('allow')
    // The tool samples again, so it answers the reading of this moment, not the one of the last turn.
    w.setLimits([fiveHour(41)])
    const text = String((await $.tool.call({ tool: TOOL } as never)).result)
    expect(text).toContain('5-hour limit: 41% used, resets')
    expect(w.statuses.at(-1)).toContain('5h 41%')
    await $.command.run({ ...run, args: 'off' })
    expect((await $.tool.call({ tool: TOOL } as never)).result).toContain('limit-watch is off')
  })

  test('a subscription session shows the per-model weekly limit the usage endpoint reports', async ($, on) => {
    const w = world(on)
    w.auth = { handle: 'h1', kind: 'bearer' }
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    // The engine sets the credential header from the handle; the mod sends the handle and the beta header only.
    expect(w.fetches).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'h1', beta: 'oauth-2025-04-20' }])
    expect(w.statuses.at(-1)).toContain('5h 23%, reset in 3h · 7d Fable 25%, reset in 1d 12h')
    const text = String((await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)).result)
    expect(text).toContain('- Fable 7-day limit: 25% used, resets')
  })

  test('the usage endpoint is read at most every five minutes, never by the idle timer, and the tool keeps the interval', async ($, on) => {
    const w = world(on)
    w.auth = { handle: 'h1', kind: 'bearer' }
    await $.session.start({ ...session, isInteractive: true })
    await $.turn.complete(turn())
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    expect(w.fetches).toHaveLength(1)
    await w.clock.advance(10 * 60_000)
    expect(w.fetches).toHaveLength(1)
    w.usage.body = usageBody(30)
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    expect(w.fetches).toHaveLength(2)
    expect(w.statuses.at(-1)).toContain('7d Fable 30%')
  })

  test('every session and a reload share one read of the usage endpoint per five minutes through the store', async ($, on) => {
    // Another session of the account read the endpoint a minute ago and stored what it got.
    const shared = { at: T0 - 60_000, readAt: T0 - 60_000, limits: [{ kind: 'seven_day:Fable', percentUsed: 44, resetsAt: '2026-09-20T00:00:00Z' }] }
    const w = world(on, { scoped: shared })
    w.auth = { handle: 'h1', kind: 'bearer' }
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    expect(w.fetches).toEqual([])
    expect(w.statuses.at(-1)).toContain('7d Fable 44%')
    await w.clock.advance(5 * 60_000)
    await $.turn.complete(turn())
    expect(w.fetches).toHaveLength(1)
    expect(w.statuses.at(-1)).toContain('7d Fable 25%')
  })

  test('a 429 keeps the last reading with its time and waits as long as Retry-After asks, in every session', async ($, on) => {
    const w = world(on)
    w.auth = { handle: 'h1', kind: 'bearer' }
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    await w.clock.advance(5 * 60_000)
    w.usage = { status: 429, body: 'rate limited', retryAfter: '1800' }
    await $.turn.complete(turn())
    expect(w.fetches).toHaveLength(2)
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]).toMatch(/^cannot read the per-model limits: HTTP 429; the reading of \S+ stays, and the next read is at \S+$/)
    expect(w.statuses.at(-1)).toContain('7d Fable 25%')
    const text = String((await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)).result)
    expect(text).toContain('- Fable 7-day limit: 25% used')
    expect(text).toContain('The per-model limits are as read at ')
    expect(text).toContain('the last read of the usage endpoint failed: HTTP 429.')
    // The wait is stored, so it holds past the five minutes and for a session that starts now.
    await w.clock.advance(20 * 60_000)
    await $.turn.complete(turn())
    expect(w.fetches).toHaveLength(2)
    expect(w.store.scoped).toMatchObject({ until: T0 + 5 * 60_000 + 1_800_000 })
    await w.clock.advance(11 * 60_000)
    w.usage = { status: 200, body: usageBody(30) }
    await $.turn.complete(turn())
    expect(w.fetches).toHaveLength(3)
    expect(w.statuses.at(-1)).toContain('7d Fable 30%')
  })

  test('a session with no first-party OAuth credential sends nothing to the usage endpoint', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    w.auth = { handle: 'k1', kind: 'api-key' }
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    expect(w.fetches).toEqual([])
    expect(w.logs).toEqual([])
  })

  test('a failed endpoint read other than a 429 is logged once, drops the per-model limit and keeps the others', async ($, on) => {
    const w = world(on)
    w.auth = { handle: 'h1', kind: 'bearer' }
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect(w.statuses.at(-1)).toContain('7d Fable 25%')
    w.usage.status = 500
    await w.clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    await w.clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    expect(w.fetches).toHaveLength(3)
    expect(w.logs).toEqual(['cannot read the per-model limits: HTTP 500'])
    expect(w.statuses.at(-1)).toContain('5h 23%')
    expect(w.statuses.at(-1)).not.toContain('Fable')
    w.usage = { status: 200, body: '{"five_hour":null}' }
    await w.clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'mcp__limit-watch__limits' } as never)
    expect(w.logs.at(-1)).toBe('cannot read the per-model limits: the answer has no limits list')
  })

  test('a bare run while off reports off and opens no pane, and an unknown word gets the usage', async ($, on) => {
    const w = world(on)
    await $.command.run({ ...run, args: 'off' })
    expect((await $.command.run(run)).text).toContain('off')
    expect(w.panes).toEqual([])
    expect((await $.command.run({ ...run, args: 'maybe' })).text).toContain('on or off')
    expect(w.panes).toEqual([])
  })
})
