import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On, TurnCompleteInput } from 'claude-code'
import { BIG_GIF, TWO_FRAMES } from './fixtures.ts'

tier('user')

const T0 = Date.parse('2026-09-26T12:00:00Z')

/**
 * The world: the store, the clock, the files by path (base64), whether the store refuses a write as full,
 * how many store reads the mod made, and what another window does while a GIF is read.
 */
type World = { store: Record<string, unknown>; clock: MockClock; files: Map<string, string>; sizes: Map<string, number>; full: boolean; reads: number; duringRead?: () => void }

/** A clip of one frame, two cells wide, as another window's import leaves it in the store. */
const WINK = { width: 2, height: 1, delays: [100], frames: [[[['ab', '#ffffff']]]] }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { store: { ...store }, clock: mock.clock(on, { now: T0 }), files: new Map(), sizes: new Map(), full: false, reads: 0 }
  mock.env(on, { HOME: '/Users/u' })
  on('store.get', (_, e) => {
    w.reads += 1
    return { value: w.store[e.key] }
  })
  on('store.set', (_, e) => {
    if (w.full) throw new Error('the store is over 4 MiB')
    w.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => { delete w.store[e.key]; return { value: undefined } })
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: w.sizes.get(e.path) ?? Math.floor(((w.files.get(e.path) ?? '').replace(/=+$/, '').length * 3) / 4), mtimeMs: 1, isLink: false } }))
  // `base64 -i <path>`: the file's base64 in lines of 76, streamed in pieces of 64 KiB.
  on('process.spawn', async function* (_, e) {
    if (e.argv[0] !== 'base64' || e.argv[1] !== '-i') throw new Error(`unexpected ${e.argv.join(' ')}`)
    const text = w.files.get(e.argv[2] ?? '')
    if (text === undefined) {
      yield { stream: 'stderr' as const, text: `base64: ${e.argv[2]}: No such file or directory\n` }
      return { value: { code: 1, signal: null } }
    }
    const out = `${text.match(/.{1,76}/g)?.join('\n') ?? ''}\n`
    for (let i = 0; i < out.length; i += 65_536) yield { stream: 'stdout' as const, text: out.slice(i, i + 65_536) }
    return { value: { code: 0, signal: null } }
  })
  on('fs.read', (_, e) => {
    w.duringRead?.()
    return { value: { base64: w.files.get(e.path) ?? '' } } as never
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The engine's own band: an empty box.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  return w
}

const run = (args: string): CommandRunInput => ({ command: 'idle-art', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }

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
  test('draws the scene only once the delay has passed in a working turn, over the band\'s whole width', async ($, on) => {
    const w = world(on)
    await $.session.start(start)
    expect(await band($)).not.toContain('scene.tsx')
    await w.clock.advance(3000)
    const drawn = await band($)
    expect(drawn).toContain('"module":"hooks/scene.tsx"')
    // The band is 120 columns wide, and the scene takes all of them.
    expect(drawn).toContain('"width":120')
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

  test('a new main-loop turn takes a new style though the band was never drawn idle in between, and a subagent turn does not', async ($, on) => {
    world(on, { delay: 0 })
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await $.session.start(start)
    const styleNow = async (): Promise<string> => /"style":"(\w+)"/.exec(await band($))?.[1] ?? ''
    const done = (agentId?: string): TurnCompleteInput => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId })
    let last = await styleNow()
    await $.turn.complete(done('agent-1'))
    expect(await styleNow()).toBe(last)
    for (let i = 0; i < 8; i++) {
      await $.turn.complete(done())
      const style = await styleNow()
      expect(style).not.toBe(last)
      last = style
    }
  })

  test('under random a scene gives way to another after 20 seconds in the same turn; a chosen one stays', async ($, on) => {
    const w = world(on, { delay: 0 })
    await $.session.start(start)
    const ui = await $.ui.mount({ plugin: 'idle-art', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const styleNow = async (): Promise<string> => /"style":"([\w-]+)"/.exec(await band($))?.[1] ?? ''
    const first = await styleNow()
    await ui.advance(19_900)
    expect(await styleNow()).toBe(first)
    await ui.advance(200)
    // The cat gives way only once it has walked out, at the end of its round.
    for (let ms = 0; first === 'cat' && ms < 60_000 && (await styleNow()) === first; ms += 500) await ui.advance(500)
    const second = await styleNow()
    expect(second).not.toBe(first)
    // A message naming a scene no longer showing, as a late or repeated post, changes nothing.
    await ui.post({ next: `${first}:0` }, { in: 'idle-art' })
    expect(await styleNow()).toBe(second)
    await ui.unmount()
    await $.command.run(run('fire'))
    const fixed = await $.ui.mount({ plugin: 'idle-art', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await fixed.advance(60_000)
    expect(await styleNow()).toBe('fire')
    expect(w.store.style).toBe('fire')
  })

  test('a GIF imported under a name is kept in the store, drawn by name and by random, listed, and removed', async ($, on) => {
    const w = world(on, { delay: 0 })
    w.files.set('/work/gifs/Two Frames.gif', TWO_FRAMES)
    await $.session.start(start)
    expect((await $.command.run(run('import gifs/Two Frames.gif Blink'))).text).toBe('saved blink: 2 frames, 32×8 cells. Use it with /idle-art blink; random draws it too.')
    expect(w.store.clips).toEqual(['blink'])
    expect(w.store['clip:blink']).toMatchObject({ width: 32, height: 8, delays: [200, 300] })
    expect((await $.command.run(run('blink'))).text).toBe('on · style blink · shows 0s into a turn')
    const drawn = await band($)
    expect(drawn).toContain('"style":"blink"')
    expect(drawn).toContain('"clip":{')
    expect((await $.command.run(run('list'))).text).toBe('built in: matrix, fire, aquarium, cat\nsaved clips: blink (2 frames, 32×8)')
    expect((await $.command.run(run('remove blink'))).text).toBe('removed blink; the style is random again')
    expect(w.store.clips).toEqual([])
    expect(w.store['clip:blink']).toBeUndefined()
    expect(w.store.style).toBe('random')
    expect((await $.command.run(run('blink'))).text).toContain('unknown scene: blink')
  })

  test('a saved clip survives a new session, and random draws it among the scenes', async ($, on) => {
    const w = world(on, { delay: 0 })
    on('turn.complete', (_, e) => ({ text: e.answer }))
    w.files.set('/Users/u/blink.gif', TWO_FRAMES)
    await $.session.start(start)
    await $.command.run(run('import ~/blink.gif blink'))
    await $.session.start(start)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      seen.add(/"style":"([\w-]+)"/.exec(await band($))?.[1] ?? '')
      await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    }
    expect(seen.has('blink')).toBe(true)
  })

  test('a GIF over the 4 MiB read limit is read through base64, and one over 32 MiB is refused', async ($, on) => {
    const w = world(on)
    // The two frames with 4.5 MiB of comment blocks before the trailer: a real GIF over the read limit.
    w.files.set('/work/big.gif', BIG_GIF)
    await $.session.start(start)
    expect((await $.command.run(run('import big.gif big'))).text).toBe('saved big: 2 frames, 32×8 cells. Use it with /idle-art big; random draws it too.')
    // A stat that disagrees with what base64 decodes to is caught, not drawn from.
    w.files.set('/work/cut.gif', BIG_GIF)
    w.sizes.set('/work/cut.gif', 5 * 1024 * 1024)
    expect((await $.command.run(run('import cut.gif cut'))).text).toMatch(/^cannot import cut\.gif: base64 gave \d+ bytes of 5242880$/)
    w.files.set('/work/huge.gif', TWO_FRAMES)
    w.sizes.set('/work/huge.gif', 33 * 1024 * 1024)
    expect((await $.command.run(run('import huge.gif huge'))).text).toBe('cannot import huge.gif: /work/huge.gif is 33 MiB, over the 32 MiB limit')
  })

  test('an import that cannot read the GIF or cannot store it names the reason and keeps nothing', async ($, on) => {
    const w = world(on)
    w.files.set('/work/not.gif', 'UE5HLi4uLg==')
    w.files.set('/work/ok.gif', TWO_FRAMES)
    await $.session.start(start)
    expect((await $.command.run(run('import missing.gif a'))).text).toBe('cannot import missing.gif: /work/missing.gif does not exist')
    expect((await $.command.run(run('import not.gif a'))).text).toBe('cannot import not.gif: the file is not a GIF')
    w.full = true
    // The test engine reports a world hook's throw as `no implementation`; the engine's own words differ.
    expect((await $.command.run(run('import ok.gif a'))).text).toMatch(/^cannot save a: .+ The store holds 4 MiB in all; \/idle-art remove <name> frees room\.$/)
    expect(w.store.clips).toBeUndefined()
    expect((await $.command.run(run('list'))).text).toContain('saved clips: none')
  })

  test('the command stores each setting and answers with the state', async ($, on) => {
    const w = world(on)
    await $.session.start(start)
    expect((await $.command.run(run(''))).text).toBe('on · style random · shows 3s into a turn')
    expect((await $.command.run(run('fire'))).text).toBe('on · style fire · shows 3s into a turn')
    expect((await $.command.run(run('delay 0'))).text).toBe('on · style fire · shows 0s into a turn')
    expect((await $.command.run(run('off'))).text).toBe('off · style fire · shows 0s into a turn')
    expect(w.store).toEqual({ style: 'fire', delay: 0, enabled: false })
    expect((await $.command.run(run('delay 99'))).text).toContain('delay takes whole seconds from 0 to 60')
    expect((await $.command.run(run('rainbow'))).text).toContain('unknown scene: rainbow')
    expect(w.store.delay).toBe(0)
  })

  test('a setting another window stored applies here at the next hook that acts on it', async ($, on) => {
    const w = world(on, { delay: 0, style: 'matrix' })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await $.session.start(start)
    const ui = await $.ui.mount({ plugin: 'idle-art', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = async (): Promise<string> => JSON.stringify(await ui.drawn())
    expect(await drawn()).toContain('"style":"matrix"')
    // Every window shares the store: another one turned the mod off, and this one never ran the command.
    // The running turn reads the settings every 2 seconds, and the picture goes.
    w.store.enabled = false
    await w.clock.advance(1900)
    expect(await drawn()).toContain('"style":"matrix"')
    await w.clock.advance(100)
    expect(await drawn()).not.toContain('scene.tsx')
    // It turns the mod on again and chooses fire: the picture comes back as fire.
    w.store.enabled = true
    w.store.style = 'fire'
    await w.clock.advance(2000)
    expect(await drawn()).toContain('"style":"fire"')
    // It imports a clip and chooses it: this window loads the clip and draws it.
    w.store['clip:wink'] = WINK
    w.store.clips = ['wink']
    w.store.clipsRev = 'an import in another window'
    w.store.style = 'wink'
    await w.clock.advance(2000)
    expect(await drawn()).toContain('"style":"wink"')
    expect(await drawn()).toContain('"clip":{"width":2')
    // This window turns the mod off and the turn ends: nothing reads the store while no turn runs.
    expect((await $.command.run(run('off'))).text).toBe('off · style wink · shows 0s into a turn')
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    w.store.enabled = true
    w.store.delay = 5
    const reads = w.reads
    await w.clock.advance(10_000)
    expect(w.reads).toBe(reads)
    expect(await drawn()).not.toContain('scene.tsx')
    // The next turn reads the on and the delay another window stored, and draws once 5 seconds have passed.
    await $.turn.start({ text: 'devam et', turnId: 't2' })
    expect(await drawn()).not.toContain('scene.tsx')
    await w.clock.advance(5000)
    expect(await drawn()).toContain('"style":"wink"')
    // A command reads the settings first, so its answer is what the store holds now.
    w.store.style = 'aquarium'
    expect((await $.command.run(run(''))).text).toBe('on · style aquarium · shows 5s into a turn')
  })

  test('an import keeps a clip another window saved meanwhile, and a clip replaced or removed there is read here', async ($, on) => {
    const w = world(on, { delay: 0 })
    w.files.set('/work/a.gif', TWO_FRAMES)
    await $.session.start(start)
    // Another window saves wink while this one reads the GIF: the names this one writes keep it.
    w.duringRead = () => {
      w.store['clip:wink'] = WINK
      w.store.clips = ['wink']
    }
    expect((await $.command.run(run('import a.gif blink'))).text).toBe('saved blink: 2 frames, 32×8 cells. Use it with /idle-art blink; random draws it too.')
    w.duringRead = undefined
    expect(w.store.clips).toEqual(['wink', 'blink'])
    expect((await $.command.run(run('list'))).text).toBe('built in: matrix, fire, aquarium, cat\nsaved clips: wink (1 frames, 2×1), blink (2 frames, 32×8)')
    // Another window imports wink again under the same name: the stamp it writes makes this window read it.
    w.store['clip:wink'] = { ...WINK, delays: [100, 100], frames: [...WINK.frames, ...WINK.frames] }
    w.store.clipsRev = 'wink imported again'
    expect((await $.command.run(run('list'))).text).toContain('wink (2 frames, 2×1)')
    // Another window removes blink: this window no longer lists it or takes it as a style.
    delete w.store['clip:blink']
    w.store.clips = ['wink']
    w.store.clipsRev = 'blink removed'
    expect((await $.command.run(run('list'))).text).toBe('built in: matrix, fire, aquarium, cat\nsaved clips: wink (2 frames, 2×1)')
    expect((await $.command.run(run('blink'))).text).toContain('unknown scene: blink')
  })
})
