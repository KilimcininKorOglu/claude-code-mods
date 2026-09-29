import { describe, expect, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { keepsCacheAcrossEffort, LEVELS, levelFor, levelsOf, parseLevels, raterPrompt, RATER_SYSTEM, ratingOf } from '../hooks/effort.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'effort-auto', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const USAGE = { input_tokens: 90, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/**
 * `reply` is the rater's answer, or null for a rater that fails; `asked` holds each rating request;
 * `sent` holds the effort each model request went out with; `logs` holds the transcript lines; `store`
 * is the store every window shares, which a test writes as another window.
 */
type World = { reply: string | null; asked: { model: string; effort?: string; system?: string; prompt: string }[]; sent: (string | number | undefined)[]; logs: string[]; store: Map<string, unknown> }

function world(on: On): World {
  const w: World = { reply: 'max', asked: [], sent: [], logs: [], store: new Map() }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', (_, e) => {
    w.asked.push({ model: e.model, effort: e.effort, system: e.system, prompt: e.prompt })
    return { value: w.reply === null ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } : { isAnswered: true, text: w.reply, usage: USAGE } } as never
  })
  on('turn.step', async function* (_, e) {
    w.sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: { ...USAGE, model: e.model } }
  })
  // A started subagent's id is the description the test gives it.
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/w' })
}

const prompt = ($: Engine, text: string, kind: 'composer' | 'task-notification' = 'composer', turnId?: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind }, ...(turnId === undefined ? {} : { turnId }) } as never)

/** One model request: the session's effort is `high` unless a subagent carries its own. */
async function step($: Engine, model = 'claude-opus-5-5', agentId?: string, effort: 'low' | 'high' = 'high'): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model, messageCount: 1, effort, ...(agentId === undefined ? {} : { agentId }) })
  for await (const chunk of stream) void chunk
}

const turnEnds = ($: Engine, agentId?: string) => $.turn.complete({ turnId: 't', answer: '', reason: 'answer', ...(agentId === undefined ? {} : { agentId }) } as never)

/** Starts a subagent named `id`, from the main loop or from the subagent `parent`. */
const spawn = ($: Engine, id: string, parent?: string) =>
  $.agent.spawn({ tool_use_id: `u-${id}`, prompt: 'p', description: id, subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...(parent === undefined ? {} : { parentAgentId: parent }) })

describe('effort', () => {
  test('a rating is read from the rater\'s first word, or from "named" and the word after it', () => {
    expect(ratingOf('xhigh', 'fix it')).toEqual({ level: 'xhigh', named: false })
    expect(ratingOf(' Max.\n', 'fix it')).toEqual({ level: 'max', named: false })
    expect(ratingOf('named max', 'bunu max ile çöz')).toEqual({ level: 'max', named: true })
    expect(ratingOf('Named: XHIGH', 'use XHigh effort')).toEqual({ level: 'xhigh', named: true })
    expect(ratingOf('very high', 'fix it')).toBe(undefined)
    expect(ratingOf('named', 'fix it')).toBe(undefined)
    expect(ratingOf('', 'fix it')).toBe(undefined)
  })

  test('a level the rater calls named that the request does not hold as a word is read as a rating', () => {
    // Measured on haiku: "zor bir iş" (hard work) came back as "named max" or "named high".
    expect(ratingOf('named max', 'zor bir iş: dosyaları say')).toEqual({ level: 'max', named: false })
    expect(ratingOf('named high', 'yüksek effort ile çöz')).toEqual({ level: 'high', named: false })
    expect(ratingOf('named high', 'use xhigh here')).toEqual({ level: 'high', named: false })
    expect(ratingOf('named max', 'use maximum effort')).toEqual({ level: 'max', named: false })
  })

  test('a rated level the person does not allow moves to the nearest allowed one, the higher on a tie; a named one stays', () => {
    const allowed = levelsOf(['low', 'medium', 'max'])
    expect(levelFor({ level: 'high', named: false }, allowed)).toBe('medium')
    expect(levelFor({ level: 'xhigh', named: false }, allowed)).toBe('max')
    expect(levelFor({ level: 'high', named: false }, levelsOf(['low', 'max']))).toBe('max')
    expect(levelFor({ level: 'medium', named: false }, levelsOf(['low', 'max']))).toBe('low')
    expect(levelFor({ level: 'high', named: true }, allowed)).toBe('high')
    expect(levelFor({ level: 'max', named: false }, allowed)).toBe('max')
  })

  test('the levels command takes all or known levels in any order; the store\'s list is read in scale order', () => {
    expect(parseLevels('max, low medium')).toEqual(['low', 'medium', 'max'])
    expect(parseLevels('ALL')).toEqual([...LEVELS])
    expect(parseLevels('low hi')).toBe('levels takes all, or one or more of low, medium, high, xhigh, max; "hi" is none of them')
    expect(parseLevels('')).toBe('levels takes all, or one or more of low, medium, high, xhigh, max')
    expect(levelsOf(['max', 'low', 'x'])).toEqual(['low', 'max'])
    expect(levelsOf(undefined)).toEqual([...LEVELS])
    expect(levelsOf([])).toEqual([...LEVELS])
  })

  test('the rater rates on the whole scale, a named level comes back as its word, and calling the work hard names none', () => {
    expect(RATER_SYSTEM).toContain('Otherwise answer one word: low, medium, high, xhigh or max.')
    expect(RATER_SYSTEM).toContain('A request names a level only when it holds one of the words low, medium, high, xhigh or max')
    expect(RATER_SYSTEM).toContain('Calling the work hard, easy, simple or important, or asking to think carefully, to take time or to be thorough, names no level')
    expect(RATER_SYSTEM).toContain('answer "named" and that word, for example "named high".')
    expect(RATER_SYSTEM).not.toContain('allowed')
    expect(raterPrompt('fix it')).toBe('The request:\n<request>\nfix it\n</request>\nWhen the request names a level, answer "named" and that word.\nOtherwise answer low, medium, high, xhigh or max.\nThe level:')
  })

  test('only the models whose cache survives an effort change are changed', () => {
    expect(keepsCacheAcrossEffort('claude-opus-5-5')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-opus-5-5[1m]')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-fable-5-1')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-sonnet-5-5')).toBe(true)
    expect(keepsCacheAcrossEffort('claude-sonnet-5')).toBe(false)
    expect(keepsCacheAcrossEffort('claude-opus-5')).toBe(false)
  })

  test('a long prompt reaches the rater cut', () => {
    expect(raterPrompt('x'.repeat(5000))).toContain(`${'x'.repeat(4000)}\n[cut]`)
  })
})

describe('effort-auto', () => {
  test('the person\'s prompt is rated by haiku at low effort, and each main-loop request of its turn goes out at that level', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'redesign the cache layer')
    expect(w.asked).toEqual([{ model: 'haiku', effort: 'low', system: RATER_SYSTEM, prompt: raterPrompt('redesign the cache layer') }])
    await step($)
    await step($)
    expect(w.sent).toEqual(['max', 'max'])
    expect(w.logs).toEqual(['this turn max · session high'])
  })

  test('the next turn starts from the session\'s effort, and a subagent no rated turn started keeps its own', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'hard work')
    await step($, 'claude-opus-5-5', 'agent-1')
    await turnEnds($, 'agent-1')
    await step($)
    await turnEnds($)
    await step($)
    expect(w.sent).toEqual(['high', 'max', 'high'])
  })

  test('a subagent a rated turn starts runs at that level for its whole run, and so does one it starts', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'hard work')
    await step($)
    await spawn($, 'sub-1')
    await step($, 'claude-opus-5-5', 'sub-1')
    await spawn($, 'sub-2', 'sub-1')
    await step($, 'claude-opus-5-5', 'sub-2')
    // The main turn ends while the subagent still runs in the background: it keeps the level.
    await turnEnds($)
    await step($, 'claude-opus-5-5', 'sub-1')
    await turnEnds($, 'sub-1')
    await step($, 'claude-opus-5-5', 'sub-1')
    expect(w.sent).toEqual(['max', 'max', 'max', 'max', 'high'])
  })

  test('a subagent with its own effort keeps it, one on a model that would lose its cache is left alone, and an unrated turn\'s subagent keeps the session\'s', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'hard work')
    await step($)
    await spawn($, 'own')
    await spawn($, 'sonnet')
    await step($, 'claude-opus-5-5', 'own', 'low')
    await step($, 'claude-opus-5-5', 'own', 'low')
    await step($, 'claude-sonnet-5', 'sonnet')
    await turnEnds($)
    await prompt($, 'task done', 'task-notification')
    await step($)
    await spawn($, 'unrated')
    await step($, 'claude-opus-5-5', 'unrated')
    expect(w.sent).toEqual(['max', 'low', 'low', 'high', 'high', 'high'])
  })

  test('a rating outside the allowed levels moves to the nearest, the rater is not told them, and a level the prompt names stays', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('levels max low medium'))).text).toBe('allowed low, medium, max: a rated turn runs at the nearest of these, and a level a prompt names still applies')
    expect(w.store.get('levels')).toEqual(['low', 'medium', 'max'])
    w.reply = 'high'
    await prompt($, 'rename across files')
    expect(w.asked[0]?.system).toBe(RATER_SYSTEM)
    expect(w.asked[0]?.prompt).toBe(raterPrompt('rename across files'))
    await step($)
    await turnEnds($)
    w.reply = 'named high'
    await prompt($, 'solve this at high effort')
    await step($)
    await turnEnds($)
    // A prompt that only calls the work hard names no level, whatever the rater answered.
    w.reply = 'named high'
    await prompt($, 'zor bir iş: oturum neden düşüyor?')
    await step($)
    await turnEnds($)
    expect(w.sent).toEqual(['medium', 'high', 'medium'])
    expect(w.logs).toEqual(['this turn medium · session high', 'this turn high (named) · session high', 'this turn medium · session high'])
    expect((await $.command.run(run(''))).text).toBe('on · allowed low, medium, max')
    expect((await $.command.run(run('levels'))).text).toBe('allowed low, medium, max')
    expect((await $.command.run(run('levels low hi'))).text).toContain('"hi" is none of them')
    await $.command.run(run('levels all'))
    expect((await $.command.run(run(''))).text).toBe('on · allowed low, medium, high, xhigh, max')
  })

  test('a notification, a prompt typed over a running turn, and a rater that fails or answers no level keep the session\'s effort', async ($, on) => {
    const w = world(on)
    await started($)
    await prompt($, 'task done', 'task-notification')
    await prompt($, 'also this', 'composer', 'running-turn')
    expect(w.asked).toEqual([])
    w.reply = null
    await prompt($, 'hard work')
    await step($)
    w.reply = 'it depends'
    await prompt($, 'hard work')
    await step($)
    expect(w.sent).toEqual(['high', 'high'])
    expect(w.logs).toEqual([
      "the rater did not answer (api-error), so this turn keeps the session's effort",
      'the rater answered "it depends", so this turn keeps the session\'s effort',
    ])
  })

  test('a setting another window stored applies here at the next hook that acts on it', async ($, on) => {
    const w = world(on)
    await started($)
    // Every window shares the store: another one turned the mod off, and this one never ran the command.
    w.store.set('enabled', false)
    await prompt($, 'hard work')
    await step($)
    await turnEnds($)
    expect(w.asked).toEqual([])
    expect((await $.command.run(run(''))).text).toBe('off')
    w.store.set('enabled', true)
    // Another window allowed only low and medium: the next prompt's turn runs within them.
    w.store.set('levels', ['low', 'medium'])
    await prompt($, 'hard work')
    await step($)
    expect(w.asked).toHaveLength(1)
    expect(w.sent).toEqual(['high', 'medium'])
    expect((await $.command.run(run(''))).text).toBe('on · allowed low, medium')
  })

  test('off rates nothing, and the command answers its state', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('off'))).text).toBe("off: every turn runs at the session's effort")
    await prompt($, 'hard work')
    await step($)
    expect(w.asked).toEqual([])
    expect(w.sent).toEqual(['high'])
    expect((await $.command.run(run(''))).text).toBe('off')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off, or levels all | <level ...>')
  })
})

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

withSidebar('an open sidebar holds this turn\'s effort while it runs and the last turn\'s after it for the whole session, with the allowed levels under it', async ($, on) => {
  const w = world(on)
  const sections: { lines: { text: string }[] }[] = []
  const cleared: unknown[] = []
  on('sidebar.set', (_, e) => { sections.push(e as never); return { value: true } })
  on('sidebar.clear', (_, e) => { cleared.push(e); return { value: undefined } })
  await started($)
  await prompt($, 'hard work')
  await step($)
  await step($)
  expect(sections[0]).toEqual({
    consumer: 'effort-auto', key: 'effort', title: 'effort', until: 'session', order: 6,
    lines: [
      { text: 'this turn max · session high', parts: [{ text: 'this turn ' }, { text: 'max', kind: 'error' }, { text: ' · ' }, { text: 'session ' }, { text: 'high', kind: 'warn' }] },
      { text: 'allowed low · medium · high · xhigh · max', parts: [{ text: 'allowed ' }, { text: 'low', kind: 'dim' }, { text: ' · ' }, { text: 'medium', kind: 'ok' }, { text: ' · ' }, { text: 'high', kind: 'warn' }, { text: ' · ' }, { text: 'xhigh', kind: 'error' }, { text: ' · ' }, { text: 'max', kind: 'error' }] },
    ],
  })
  // The turn's end keeps its level as the last turn's, and a turn that was not rated shows the session's.
  await turnEnds($)
  await prompt($, 'task done', 'task-notification')
  await step($)
  await turnEnds($)
  // New allowed levels redraw the section at once.
  await $.command.run(run('levels low max'))
  expect(sections.map(s => s.lines.map(l => l.text).join(' | '))).toEqual([
    'this turn max · session high | allowed low · medium · high · xhigh · max',
    'last turn max · session high | allowed low · medium · high · xhigh · max',
    'this turn high (session) · session high | allowed low · medium · high · xhigh · max',
    'last turn high (session) · session high | allowed low · medium · high · xhigh · max',
    'last turn high (session) · session high | allowed low · max',
  ])
  expect(cleared).toEqual([])
  expect(w.logs).toEqual([])
  // Off takes the section down.
  await $.command.run(run('off'))
  expect(cleared).toEqual([{ consumer: 'effort-auto', key: 'effort' }])
})
