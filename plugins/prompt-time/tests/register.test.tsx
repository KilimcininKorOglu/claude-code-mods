import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { On, PromptSubmitInput, RenderPropsOf, TurnCompleteInput } from 'claude-code'

tier('user')

const START = Date.parse('2026-09-18T19:10:55Z')

const prompt = (text: string): PromptSubmitInput => ({ text, wait: false, origin: { kind: 'composer' } })

const message = (text: string): RenderPropsOf['UserMessage'] => ({ text, origin: { kind: 'composer' }, isExpanded: false })

const done = (turnId: string): TurnCompleteInput => ({ answer: 'ok', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The label the mod draws for a message sent at START, in the machine's time zone. */
const LABEL = `${pad(new Date(START).getHours())}:${pad(new Date(START).getMinutes())}`

// Beneath the plugins, the engine takes a prompt (or drops it) and draws a
// message as its text alone.
function world(on: On, opts: { drop?: string } = {}): void {
  mock.clock(on, { now: START })
  on('prompt.submit', (_, e) => (opts.drop === undefined ? { text: e.text } : { drop: opts.drop }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
}

function draw($: Engine, id: string, text: string) {
  return $.ui.mount({ plugin: 'prompt-time', surface: 'terminal', component: 'UserMessage', requestId: id, props: message(text) })
}

function reply($: Engine, id: string, text: string) {
  return $.ui.mount({ plugin: 'prompt-time', surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text, isFirstOfReply: true } })
}

describe('prompt-time', () => {
  test('draws the send time under a message just submitted', async ($, on) => {
    world(on)
    await $.prompt.submit(prompt('hello'))
    const ui = await draw($, 'm1', 'hello')
    expect(await ui.find({ type: 'Text', text: 'hello' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: LABEL }))?.text).toBe(LABEL)
  })

  test('leaves a message whose time it does not know as the engine drew it', async ($, on) => {
    world(on)
    const ui = await draw($, 'm1', 'old')
    expect(await ui.drawn()).toMatchObject({ type: 'Text' })
  })

  test('a message drawn before the prompt does not take its time', async ($, on) => {
    world(on)
    const old = await draw($, 'm1', 'old')
    await $.prompt.submit(prompt('new'))
    await old.redraw()
    expect(await old.find({ type: 'Text', text: LABEL })).toBe(undefined)
    const fresh = await draw($, 'm2', 'new')
    expect(await fresh.find({ type: 'Text', text: LABEL })).toBeDefined()
  })

  test('a dropped prompt leaves no time for the next new row', async ($, on) => {
    world(on, { drop: 'refused beneath' })
    const r = await $.prompt.submit(prompt('refused'))
    expect(r.drop).toBe('refused beneath')
    const ui = await draw($, 'm1', 'refused')
    expect(await ui.find({ type: 'Text', text: LABEL })).toBe(undefined)
  })

  test('a prompt drawn under two ids shows the time under both', async ($, on) => {
    world(on)
    await $.prompt.submit(prompt('hello '))
    const entering = await draw($, 'placeholder', 'hello')
    const stored = await draw($, 'm1', 'hello')
    expect(await entering.find({ type: 'Text', text: LABEL })).toBeDefined()
    expect(await stored.find({ type: 'Text', text: LABEL })).toBeDefined()
  })

  test('a new row with another text does not take the prompt\'s time', async ($, on) => {
    world(on)
    await $.prompt.submit(prompt('hello'))
    const ui = await draw($, 'n1', 'a background task finished')
    expect(await ui.find({ type: 'Text', text: LABEL })).toBe(undefined)
  })

  test('keeps the time of a message across redraws', async ($, on) => {
    world(on)
    await $.prompt.submit(prompt('hello'))
    const ui = await draw($, 'm1', 'hello')
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: LABEL })).toBeDefined()
  })

  test('draws the time under a reply block written during a turn, and keeps it after', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'hello', turnId: 't1' })
    const ui = await reply($, 'a1', 'Hi.')
    expect(await ui.find({ type: 'Text', text: 'Hi.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LABEL })).toBeDefined()
    await $.turn.complete(done('t1'))
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: LABEL })).toBeDefined()
  })

  test('leaves a reply block first drawn outside a turn as the engine drew it', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await $.turn.complete(done('t1'))
    const ui = await reply($, 'a1', 'old reply')
    expect(await ui.drawn()).toMatchObject({ type: 'Text' })
  })

  test('the final block first drawn just after its turn ended takes the time, once', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await $.turn.complete({ ...done('t1'), answer: 'Last block.\n' })
    const last = await reply($, 'a1', 'Last block.')
    expect(await last.find({ type: 'Text', text: LABEL })).toBeDefined()
    const again = await reply($, 'a2', 'Last block.')
    expect(await again.drawn()).toMatchObject({ type: 'Text' })
  })

  test('a subagent\'s final text gives no time to a block of the main transcript', async ($, on) => {
    world(on)
    await $.turn.complete({ ...done('t2'), answer: 'Found it.', agentId: 'a9' })
    const ui = await reply($, 'a1', 'Found it.')
    expect(await ui.drawn()).toMatchObject({ type: 'Text' })
  })
})
