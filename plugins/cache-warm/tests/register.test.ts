import { describe, expect, mock, test, tier, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On, SessionStartInput, TurnCompleteInput, TurnUsage } from 'claude-code'

tier('user')

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const START = 1_000_000_000

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 500, model: 'claude-fable-5-1', ...over,
})

// TurnCompleteInput is a union on `reason`; these tests drive the answered arm.
type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
let turns = 0
const turn = (over: Partial<AnsweredTurn> = {}): TurnCompleteInput => ({
  answer: 'ok', durationMs: 1000, isAborted: false, turnId: `t${++turns}`, reason: 'answer', usage: usage(), ...over,
})

const run = (command: 'cache-warm' | 'cache-status', args = ''): CommandRunInput => ({
  command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** What a fork reports: the cache read and write, or null for no reply, or an Error to throw. */
type ForkAnswer = null | Error | { read: number; write: number; out?: number }

type World = {
  clock: MockClock
  store: Map<string, unknown>
  forks: number
  statuses: (string | undefined)[]
  logs: string[]
  live: { tokens?: number }
}

// The engine beneath the mod: the store, the session, and a fork that answers
// from a script, so each test decides what the cache looked like.
function world(on: On, answers: ForkAnswer[], opts: { store?: [string, unknown][]; sid?: string } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: START }),
    store: new Map(opts.store ?? []),
    forks: 0,
    statuses: [],
    logs: [],
    live: {},
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: opts.sid ?? 'S1' }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.usage', () => ({ value: { context: { window: 1_000_000, tokens: w.live.tokens }, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.compact', (_, e) => ({ messages: e.messages }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('model.fork', () => {
    w.forks++
    const a = answers.shift()
    if (a instanceof Error) throw a
    if (a === null || a === undefined) return { value: null }
    const u = { input_tokens: 2, output_tokens: a.out ?? 1, cache_read_input_tokens: a.read, cache_creation_input_tokens: a.write }
    return { value: { text: 'warm', usage: u } }
  })
  return w
}

const warm: ForkAnswer = { read: 200_000, write: 0 }

describe('keep warm', () => {
  test('a bare /cache-warm pings 50 minutes after the last request, then again', async ($, on) => {
    const w = world(on, [warm, warm])
    await $.session.start(session)
    const r = await $.command.run(run('cache-warm'))
    expect(r.text).toBe('on for 6h00m, a ping 50m after each idle stretch keeps the cache read, not re-written')
    expect(w.statuses.at(-1)).toBe('6h00m left · waiting for the first turn')
    await $.turn.complete(turn())
    expect(w.statuses.at(-1)).toBe('6h00m left · ping in 50m')
    await w.clock.advance(49 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(MIN)
    expect(w.forks).toBe(1)
    expect(w.statuses.at(-1)).toBe('5h10m left · ping in 50m · last ping read 200k $0.05')
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(2)
  })

  test('a new turn moves the ping later', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(40 * MIN)
    await $.turn.complete(turn())
    await w.clock.advance(40 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a subagent turn does not move the ping', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(40 * MIN)
    await $.turn.complete(turn({ agentId: 'a1' }))
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(1)
  })

  test('stops when a ping finds the cache gone', async ($, on) => {
    const w = world(on, [{ read: 0, write: 180_000 }, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone')
    await w.clock.advance(2 * HOUR)
    expect(w.forks).toBe(1)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toMatch(/^stopped: /)
  })

  test('a ping\'s own small write passes, a partial re-write stops the loop', async ($, on) => {
    const w = world(on, [{ read: 200_000, write: 500 }, { read: 75_000, write: 70_000 }, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h every 1m'))
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.statuses.at(-1)).toMatch(/^5h59m left · ping in 1m · last ping read 200k/)
    await w.clock.advance(MIN)
    expect(w.statuses.at(-1)).toMatch(/^stopped: the ping read 75k and wrote 70k tokens/)
    await w.clock.advance(5 * MIN)
    expect(w.forks).toBe(2)
  })

  test('stops when the engine sends no ping', async ($, on) => {
    const w = world(on, [null])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('stopped: the engine did not send the ping; the snapshot was cold or the API call failed')
  })

  test('stops with the error when the fork throws', async ($, on) => {
    const w = world(on, [new Error('rate limited')])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    // The engine skips a hook that throws and rejects the call with its own error.
    expect(w.statuses.at(-1)).toMatch(/^stopped: the ping failed, \S/)
    expect(w.forks).toBe(1)
  })

  test('the ping figure counts the output at the model\'s rate', async ($, on) => {
    const w = world(on, [{ read: 200_000, write: 0, out: 1000 }])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn({ usage: usage({ model: 'claude-sonnet-5' }) }))
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('5h10m left · ping in 50m · last ping read 200k $0.05')
  })

  test('the window ends on its own and forgets the every period', async ($, on) => {
    const w = world(on, [warm, warm, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '3m every 1m'))
    expect(w.store.get('every:S1')).toBe(MIN)
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(1)
    await w.clock.advance(5 * MIN)
    expect(w.forks).toBe(2)
    expect(w.statuses.at(-1)).toBe(undefined)
    expect(w.store.has('deadline:S1')).toBe(false)
    expect(w.store.has('every:S1')).toBe(false)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(2)
  })

  test('off cancels the ping and clears the status', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    const off = await $.command.run(run('cache-warm', 'off'))
    expect(off.text).toBe('off')
    expect(w.statuses.at(-1)).toBe(undefined)
    await w.clock.advance(2 * HOUR)
    expect(w.forks).toBe(0)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toBe('off')
  })

  test('an argument it cannot read changes nothing', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    const r = await $.command.run(run('cache-warm', 'soon'))
    expect(r.text).toBe('expects a window such as 6h or 90m, or always, off, or status')
    expect(w.store.size).toBe(0)
  })
})

describe('always', () => {
  test('/cache-warm always sets the switch and arms now', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    const r = await $.command.run(run('cache-warm', 'always'))
    expect(r.text).toMatch(/^always on: every session starts with a 6h00m window/)
    expect(w.store.get('always')).toBe(true)
    expect(w.store.get('deadline:S1')).toBe(START + 6 * HOUR)
  })

  test('a session start arms a fresh default window over a stale one, and off ends it for good', async ($, on) => {
    const w = world(on, [warm], { store: [['always', true], ['deadline:S1', START + 10 * MIN], ['every:S1', MIN]] })
    await $.session.start(session)
    expect(w.store.get('deadline:S1')).toBe(START + 6 * HOUR)
    expect(w.store.has('every:S1')).toBe(false)
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(49 * MIN)
    expect(w.forks).toBe(1)
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/keep warm   on, 5h10m left · ping in 50m · last ping read 200k \$0\.05 \(always\)/)
    const off = await $.command.run(run('cache-warm', 'off'))
    expect(off.text).toBe('off, and no longer arms itself at session start')
    expect(w.store.has('always')).toBe(false)
  })
})

describe('cold writes', () => {
  test('a paid cold write is scored and keeps the cache warm for three hours', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.advance(3 * HOUR)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_502 }) }))
    expect(w.logs.at(-1)).toBe('cold write of 201k tokens paid ($4.01). Keeping the cache warm for 3h00m; /cache-warm off stops it.')
    expect(w.statuses.at(-1)).toBe('3h00m left · ping in 50m')
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(1)
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/session     1 cold write paid, \$4\.01/)
    expect(status.text).toMatch(/keep warm   on, 2h10m left/)
  })

  test('a longer window already armed is kept', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_502 }) }))
    expect(w.store.get('deadline:S1')).toBe(START + 6 * HOUR)
    expect(w.logs).toEqual([])
  })

  test('the context comes from the live window, not the turn\'s summed usage', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    w.live.tokens = 100_000
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 500_000, cache_creation_input_tokens: 2_000 }) }))
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/context     100,000 tokens/)
    expect(status.text).toMatch(/0 cold writes paid/)
  })

  test('the card states the break-even and the cold price', async ($, on) => {
    world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    const status = (await $.command.run(run('cache-status'))).text
    expect(status).toMatch(/^claude-fable-5-1\nstate       warm, 1h00m left/)
    expect(status).toMatch(/cold cost   \$4\.01 to re-write it \(warm turn \$0\.05\)/)
    expect(status).toMatch(/break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m/)
  })
})

describe('compaction', () => {
  test('holds the ping until the first turn after a compaction', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(10 * MIN)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
    expect(w.statuses.at(-1)).toBe('5h50m left · waiting for the first turn')
    expect((await $.command.run(run('cache-status'))).text).toMatch(/state       reset by compaction/)
    await w.clock.advance(HOUR)
    expect(w.forks).toBe(0)
  })
})

describe('store per session', () => {
  test('another session\'s window does not arm this one and is left alone', async ($, on) => {
    const w = world(on, [warm], { sid: 'mine', store: [['deadline:other', START + HOUR], ['every:other', MIN]] })
    await $.session.start(session)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toBe('off')
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(0)
    expect(w.store.get('deadline:other')).toBe(START + HOUR)
  })

  test('this session\'s own window is restored on start', async ($, on) => {
    const w = world(on, [warm], { sid: 'mine', store: [['deadline:mine', START + 2 * HOUR], ['every:mine', MIN]] })
    await $.session.start(session)
    expect(w.statuses.at(-1)).toBe('2h00m left · waiting for the first turn')
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(1)
  })

  test('off deletes only this session\'s keys and the always switch', async ($, on) => {
    const w = world(on, [], { sid: 'mine', store: [['deadline:other', START + HOUR], ['every:other', MIN], ['always', true]] })
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h every 1m'))
    expect(w.store.get('every:mine')).toBe(MIN)
    await $.command.run(run('cache-warm', 'off'))
    expect([...w.store.keys()]).toEqual(['deadline:other', 'every:other'])
  })

  test('a start clears its own ended window and other windows ended over a week ago', async ($, on) => {
    const w = world(on, [], {
      sid: 'mine',
      store: [
        ['deadline:mine', START - MIN], ['every:mine', MIN],
        ['deadline:recent', START - DAY], ['every:recent', MIN],
        ['deadline:old', START - 8 * DAY], ['every:old', MIN],
        ['deadline:live', START + HOUR],
        ['deadline:broken', 'x'],
      ],
    })
    await $.session.start(session)
    expect([...w.store.keys()]).toEqual(['deadline:recent', 'every:recent', 'deadline:live'])
  })
})
