import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On, PromptOrigin, PromptSubmitInput, RenderPropsOf } from 'claude-code'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'prompt-deck', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const typed = (text: string, origin: PromptOrigin = { kind: 'composer' }): PromptSubmitInput => ({ text, wait: false, origin })

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['AbovePrompt']

/**
 * What reached the engine beneath the plugin, by the way it went (a typed or plugin prompt, or the mod's
 * `send` command), the lines it logged, and what it kept in the store.
 */
type World = {
  entered: { text: string; origin?: PromptOrigin; via: 'prompt' | 'send' }[]
  logs: string[]
  store: Record<string, unknown>
  gitFails?: true
  sendFails?: true
  root: string
  clock: MockClock
}

function world(on: On, store: Record<string, unknown> = {}): World {
  const clock = mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') })
  const w: World = { entered: [], logs: [], store, root: '/Users/u/app', clock }
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_, e) => { delete w.store[e.key]; return { value: undefined } })
  // git answers with the repository root, so the project is its last path part.
  on('session.cwd', () => ({ value: w.root }))
  on('process.run', () => {
    // A throwing world hook reaches the mod as a rejected call, as a missing git does.
    if (w.gitFails === true) throw new Error('git: command not found')
    return { value: { exitCode: 0, stdout: `${w.root}\n`, stderr: '' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // The engine draws nothing of its own in the band.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{''}</Text>
  })
  on('prompt.submit', (_, e) => {
    w.entered.push({ text: e.text, origin: e.origin, via: 'prompt' })
    return { text: e.text, origin: e.origin }
  })
  on('command.run', { command: 'prompt-deck:send' }, (_, e) => {
    if (w.sendFails === true) throw new Error('unknown command')
    w.entered.push({ text: e.args, origin: e.origin, via: 'send' })
    return {}
  })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/Users/u/app' })
}

const band = ($: Engine, props = BAND) => $.ui.mount({ plugin: 'prompt-deck', surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt', props })

describe('prompt-deck', () => {
  test('a prompt typed three times reaches the band, and its key sends it at once and counts the press', async ($, on) => {
    const w = world(on)
    await started($)
    for (let i = 0; i < 3; i++) await $.prompt.submit(typed(' commitle '))
    await $.prompt.submit(typed('commitle', { kind: 'task-notification' }))
    await $.prompt.submit(typed('/prompt-deck'))
    const ui = await band($)
    const button = await ui.find({ type: 'Button', key: 'deck:1' })
    expect(button?.props.label).toBe('commitle')
    expect(button?.props.hotkey).toBe('1')
    expect((await $.command.run(run('list'))).text).toBe('on · project app\n1. commitle (3)')
    await ui.press({ key: 'deck:1' })
    await w.clock.settle()
    expect(w.entered.at(-1)).toEqual({ text: 'commitle', origin: { kind: 'plugin', name: 'prompt-deck' }, via: 'send' })
    expect((await $.command.run(run('list'))).text).toBe('on · project app\n1. commitle (4)')
  })

  test('the band yields to a survey, a running turn and an agent view', async ($, on) => {
    world(on)
    await started($)
    for (let i = 0; i < 3; i++) await $.prompt.submit(typed('devam et'))
    for (const [i, props] of [{ ...BAND, hasSurvey: true }, { ...BAND, isWorking: true }, { ...BAND, view: { agentId: 'a1' } }].entries()) {
      const ui = await $.ui.mount({ plugin: 'prompt-deck', surface: 'terminal', component: 'AbovePrompt', requestId: `band-${i}`, props })
      expect(await ui.find({ type: 'Button', key: 'deck:1' })).toBe(undefined)
    }
    expect(await (await band($)).find({ type: 'Button', key: 'deck:1' })).not.toBe(undefined)
  })

  test('remove, clear and off change what is counted and drawn', async ($, on) => {
    world(on)
    await started($)
    for (let i = 0; i < 3; i++) await $.prompt.submit(typed('a'))
    for (let i = 0; i < 4; i++) await $.prompt.submit(typed('b'))
    expect((await $.command.run(run('remove 1'))).text).toBe('removed; 1 prompt(s) left')
    expect((await $.command.run(run('remove 9'))).text).toBe('no prompt at 9; /prompt-deck list names the numbers')
    expect((await $.command.run(run('off'))).text).toBe('off: nothing is counted or drawn; the counts stay')
    await $.prompt.submit(typed('c'))
    expect(await (await band($)).find({ type: 'Button', key: 'deck:1' })).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('off · project app\n1. a (3)')
    expect((await $.command.run(run('clear'))).text).toBe('cleared: no prompt is pinned or counted')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the band), list, add <text>, remove <n>, clear, on or off')
  })

  test('a prompt added by hand is pinned first on the band, whatever the counts say', async ($, on) => {
    const w = world(on)
    await started($)
    for (let i = 0; i < 4; i++) await $.prompt.submit(typed('devam et'))
    const long = 'raporu hazırla ve her bölümünü ayrı ayrı gözden geçir, sonra bana tek bir özet olarak ver'
    expect((await $.command.run(run(`add ${long}`))).text).toBe('pinned at 1 of 5')
    expect((await $.command.run(run(`add ${long}`))).text).toBe('that prompt is already pinned')
    expect((await $.command.run(run('add /clear'))).text).toBe('add expects one line of text that does not start with /')
    const ui = await band($)
    expect((await ui.find({ type: 'Button', key: 'deck:1' }))?.props.label).toBe('raporu hazırla ve her bölümünü ayrı ayrı göz…')
    expect((await ui.find({ type: 'Button', key: 'deck:2' }))?.props.label).toBe('devam et')
    expect((await $.command.run(run('list'))).text).toBe(`on · project app\n1. ${long} (pinned)\n2. devam et (4)`)
    await ui.press({ key: 'deck:1' })
    await w.clock.settle()
    expect(w.entered.at(-1)?.text).toBe(long)
    expect((await $.command.run(run('remove 1'))).text).toBe('removed; 1 prompt(s) left')
    expect(w.store['pins:/Users/u/app']).toEqual([])
  })

  test('a git that does not run names the project after the session directory', async ($, on) => {
    const w = world(on)
    w.gitFails = true
    await started($)
    for (let i = 0; i < 3; i++) await $.prompt.submit(typed('devam et'))
    expect((await $.command.run(run('list'))).text).toBe('on · project app\n1. devam et (3)')
    expect(w.store['counts:/Users/u/app']).not.toBe(undefined)
  })

  test('a deck kept under the project name alone moves to the root once, and a second checkout of that name starts empty', async ($, on) => {
    const w = world(on, { 'counts:app': { 'devam et': { n: 4, last: 5 } }, 'pins:app': ['commitle'] })
    await started($)
    expect((await $.command.run(run('list'))).text).toBe('on · project app\n1. commitle (pinned)\n2. devam et (4)')
    expect(w.store['counts:app']).toBe(undefined)
    expect(w.store['pins:app']).toBe(undefined)
    expect(w.store['counts:/Users/u/app']).toEqual({ 'devam et': { n: 4, last: 5 } })
    expect(w.store['pins:/Users/u/app']).toEqual(['commitle'])
    // Another checkout of the same name starts its own deck, and the first keeps its own.
    w.root = '/Users/u/other/app'
    await $.session.start({ surface: null, isInteractive: true, cwd: w.root })
    expect((await $.command.run(run('list'))).text).toContain('no prompt counted yet')
    for (let i = 0; i < 3; i++) await $.prompt.submit(typed('başka'))
    expect(w.store['counts:/Users/u/app']).toEqual({ 'devam et': { n: 4, last: 5 } })
  })

  test('the counts of the one shared deck move into this project once, and other projects start empty', async ($, on) => {
    const w = world(on, { counts: { 'devam et': { n: 7, last: 5 } } })
    await started($)
    expect((await $.command.run(run('list'))).text).toBe('on · project app\n1. devam et (7)')
    expect(w.store['counts']).toBe(undefined)
    expect(w.store['counts:/Users/u/app']).toEqual({ 'devam et': { n: 7, last: 5 } })
  })

  test('a prompt that reads as a command chain, and a send the engine refuses, go out as a plugin prompt', async ($, on) => {
    const w = world(on)
    await started($)
    const chain = 'testleri çalıştır && /commit'
    expect((await $.command.run(run(`add ${chain}`))).text).toBe('pinned at 1 of 5')
    expect((await $.command.run(run('add devam et'))).text).toBe('pinned at 2 of 5')
    const ui = await band($)
    await ui.press({ key: 'deck:1' })
    await w.clock.settle()
    expect(w.entered.at(-1)?.text).toBe(chain)
    expect(w.entered.at(-1)?.via).toBe('prompt')
    w.sendFails = true
    await ui.press({ key: 'deck:2' })
    await w.clock.settle()
    expect(w.entered.at(-1)?.text).toBe('devam et')
    expect(w.entered.at(-1)?.via).toBe('prompt')
    expect(w.logs.at(-1)).toContain('the send command did not run, the prompt goes out as a plugin prompt')
  })
})
