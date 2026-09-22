import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, SessionRateLimit, SessionStartInput, TurnCompleteInput, UiPane } from 'claude-code'

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
  setLimits: (l: SessionRateLimit[]) => void
  /** How many of the next usage reads fail. */
  failUsage: number
  clock: MockClock
  /** What the store holds; another session writes here too. */
  store: Record<string, unknown>
}

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { logs: [], statuses: [], panes: [], setLimits: () => undefined, failUsage: 0, clock: mock.clock(on, { now: T0 }), store: { ...store } }
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

/** The sections the sidebar took; `open` says whether it takes them at all. */
type Bar = { open: boolean; sections: { title: string; lines: { text: string; kind?: string }[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const section = e as unknown as { title: string; lines: { text: string; kind?: string }[] }
    if (bar.open) bar.sections.push({ title: section.title, lines: section.lines })
    return { value: bar.open }
  })
}

describe('limit-watch', () => {
  test('pins a status line with every limit at session start', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23), { kind: 'seven_day', percentUsed: 8, resetsAt: '2026-09-20T00:00:00Z' }])
    await $.session.start(session)
    expect(w.statuses.at(-1)).toBe('5h 23%, reset in 3h · 7d 8%, reset in 1d 12h · measuring the pace')
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
        { text: '5h 23%, reset in 3h', kind: 'ok' },
        { text: '7d 88%, reset in 1d 12h', kind: 'warn' },
        { text: 'measuring the pace', kind: 'dim' },
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
    expect(bar.sections.at(-1)?.lines[0]).toEqual({ text: '5h 96%, reset in 3h', kind: 'error' })
    w.setLimits([fiveHour(100)])
    await $.turn.complete(turn())
    expect(bar.sections.at(-1)?.lines.at(-1)).toEqual({ text: '5h limit reached', kind: 'error' })
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
})
