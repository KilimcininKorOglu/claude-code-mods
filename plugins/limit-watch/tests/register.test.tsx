import { describe, expect, mock, test, tier } from 'claude-code/testing'
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
  command: 'limits',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
}

type World = {
  logs: string[]
  statuses: (string | undefined)[]
  panes: UiPane[]
  setLimits: (l: SessionRateLimit[]) => void
}

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { logs: [], statuses: [], panes: [], setLimits: () => undefined }
  let limits: SessionRateLimit[] = []
  w.setLimits = l => {
    limits = l
  }
  mock.store(on, store)
  on('clock.now', () => ({ value: T0 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { context: { window: 200_000 }, rateLimits: limits } }))
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
    return { value: undefined }
  })
  on('ui.close', (_, e) => {
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  return w
}

const fiveHour = (percentUsed: number, resetsAt = RESET): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt })

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

  test('/limits opens the pane and closes it on the second run', async ($, on) => {
    const w = world(on)
    w.setLimits([fiveHour(23)])
    await $.session.start(session)
    expect((await $.command.run(run)).text).toContain('pane open')
    expect(w.panes.map(p => p.id)).toEqual(['limit-watch'])
    expect((await $.command.run(run)).text).toContain('pane closed')
    expect(w.panes).toEqual([])
  })
})
