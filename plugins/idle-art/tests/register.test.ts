import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

const T0 = Date.parse('2026-09-26T12:00:00Z')

type World = { store: Record<string, unknown>; clock: MockClock }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { store: { ...store }, clock: mock.clock(on, { now: T0 }) }
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The engine's own band: an empty box.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  return w
}

const run = (args: string): CommandRunInput => ({ command: 'idle-art', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

type Band = { isWorking?: boolean; hasSurvey?: boolean; maxRows?: number; surface?: 'terminal' | 'desktop' }

async function band($: Engine, b: Band = {}): Promise<string> {
  const tree = await $.ui.render({
    surface: b.surface ?? 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: b.hasSurvey ?? false, isWorking: b.isWorking ?? true, maxRows: b.maxRows ?? 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  return JSON.stringify(tree ?? null)
}

const start = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

describe('register', () => {
  test('draws the scene only once the delay has passed in a working turn, sized to the band', async ($, on) => {
    const w = world(on)
    await $.session.start(start)
    expect(await band($)).not.toContain('scene.tsx')
    await w.clock.advance(3000)
    const drawn = await band($)
    expect(drawn).toContain('"module":"hooks/scene.tsx"')
    expect(drawn).toContain('"width":100')
    expect(drawn).toContain('"height":8')
  })

  test('an idle band ends the turn, so the next turn waits for its own delay', async ($, on) => {
    const w = world(on, { delay: 0 })
    await $.session.start(start)
    expect(await band($)).toContain('"module":"hooks/scene.tsx"')
    expect(await band($, { isWorking: false })).not.toContain('scene.tsx')
    await $.command.run(run('delay 5'))
    expect(await band($)).not.toContain('scene.tsx')
    await w.clock.advance(5000)
    expect(await band($)).toContain('"module":"hooks/scene.tsx"')
  })

  test('draws nothing while off, under a survey, on another surface or in a band too short for a picture', async ($, on) => {
    world(on, { delay: 0 })
    await $.session.start(start)
    expect(await band($, { hasSurvey: true })).not.toContain('scene.tsx')
    expect(await band($, { surface: 'desktop' })).not.toContain('scene.tsx')
    expect(await band($, { maxRows: 2 })).not.toContain('scene.tsx')
    await $.command.run(run('off'))
    expect(await band($)).not.toContain('scene.tsx')
  })

  test('a chosen style is the one drawn at every turn', async ($, on) => {
    world(on, { delay: 0, style: 'fire' })
    await $.session.start(start)
    for (let i = 0; i < 3; i++) {
      expect(await band($)).toContain('"style":"fire"')
      await band($, { isWorking: false })
    }
  })

  test('random never draws the same style two turns in a row', async ($, on) => {
    world(on, { delay: 0 })
    await $.session.start(start)
    let last = ''
    for (let i = 0; i < 12; i++) {
      const style = /"style":"(\w+)"/.exec(await band($))?.[1] ?? ''
      expect(style).not.toBe(last)
      last = style
      await band($, { isWorking: false })
    }
  })

  test('the command stores each setting and answers with the state', async ($, on) => {
    const w = world(on)
    await $.session.start(start)
    expect((await $.command.run(run(''))).text).toBe('on · style random · shows 3s into a turn')
    expect((await $.command.run(run('stars'))).text).toBe('on · style stars · shows 3s into a turn')
    expect((await $.command.run(run('delay 0'))).text).toBe('on · style stars · shows 0s into a turn')
    expect((await $.command.run(run('off'))).text).toBe('off · style stars · shows 0s into a turn')
    expect(w.store).toEqual({ style: 'stars', delay: 0, enabled: false })
    expect((await $.command.run(run('delay 99'))).text).toContain('delay takes whole seconds from 0 to 60')
    expect((await $.command.run(run('rainbow'))).text).toContain('unknown argument: rainbow')
    expect(w.store.delay).toBe(0)
  })
})
