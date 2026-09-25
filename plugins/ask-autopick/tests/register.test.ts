import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { minutesOf, pickedLine, pickedLog, picksOf, waitsLine, waitsLog } from '../hooks/pick.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'ask-autopick', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const COLOR = { question: 'Renk?', options: [{ label: 'Mavi (Recommended)' }, { label: 'Kırmızı' }] }
const SIZE = { question: 'Boyut?', options: [{ label: 'Büyük (Önerilen)' }, { label: 'Küçük' }] }

/**
 * The dialog beneath the mod: it stays open until the test answers it with `answer`, and records whether
 * it was left open when the call returned. `logs` holds the lines the mod wrote.
 */
type World = { clock: MockClock; logs: string[]; answer?: (label: string) => void }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { clock: mock.clock(on), logs: [] }
  mock.store(on, store)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('tool.call', { tool: /^AskUserQuestion$/ }, (_, e) => new Promise(resolve => {
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]?.question ?? ''
    w.answer = label => resolve({ result: { answers: { [q]: label } } } as never)
  }))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

const ask = ($: Engine, questions: unknown[]) => $.tool.call({ tool: 'AskUserQuestion', questions } as never)

type Answered = { result?: { answers?: Record<string, string> }; context?: string[] }

describe('ask-autopick', () => {
  test('is off after an install, so a question waits for the person however long it takes', async ($, on) => {
    const w = world(on)
    await started($)
    const call = ask($, [COLOR])
    await w.clock.advance(60 * 60_000)
    w.answer?.('Kırmızı')
    expect(((await call) as Answered).result?.answers).toEqual({ 'Renk?': 'Kırmızı' })
    expect(w.logs).toEqual([])
  })

  test('once on, a question unanswered for 10 minutes gets its recommended option, and the model is told', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('on'))).text).toBe('on · a question unanswered for 10 min gets its recommended option')
    const call = ask($, [COLOR, SIZE])
    await w.clock.advance(10 * 60_000 - 1)
    await w.clock.advance(1)
    const r = (await call) as Answered
    expect(r.result?.answers).toEqual({ 'Renk?': 'Mavi (Recommended)', 'Boyut?': 'Büyük (Önerilen)' })
    expect(r.context?.[0]).toContain('did not answer within 10 minutes')
    expect(w.logs).toEqual(['no answer in 10 min, picked the recommended option: Renk? → Mavi (Recommended); Boyut? → Büyük (Önerilen)'])
  })

  test('an answer before the wait ends is the person\'s, and nothing is picked later', async ($, on) => {
    const w = world(on, { enabled: true, minutes: 2 })
    await started($)
    const call = ask($, [COLOR])
    await w.clock.advance(60_000)
    w.answer?.('Kırmızı')
    expect(((await call) as Answered).result?.answers).toEqual({ 'Renk?': 'Kırmızı' })
    await w.clock.advance(5 * 60_000)
    expect(w.logs).toEqual([])
  })

  test('a question with no single recommended option waits, and says so', async ($, on) => {
    const w = world(on, { enabled: true })
    await started($)
    const call = ask($, [COLOR, { question: 'Ad?', options: [{ label: 'a' }, { label: 'b' }] }])
    await w.clock.advance(30 * 60_000)
    expect(w.logs).toEqual(['a question has no recommended first option or takes several answers, so it waits for you past 10 min'])
    w.answer?.('Mavi (Recommended)')
    expect(((await call) as Answered).context).toBe(undefined)
  })

  test('the wait is set in minutes, kept, and a value out of range is refused', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('5'))).text).toBe('off · questions wait for you; /ask-autopick on picks the recommended option after 5 min')
    expect((await $.command.run(run('0'))).text).toBe('expects nothing (the status), on, off, or a number of minutes from 1 to 120')
    expect((await $.command.run(run('soon'))).text).toBe('expects nothing (the status), on, off, or a number of minutes from 1 to 120')
    expect(w.logs).toEqual([])
    for (const bad of ['0', '121', '1.5', '']) expect(minutesOf(bad), bad).toBe(undefined)
    expect(minutesOf('120')).toBe(120)
  })
})

describe('picks', () => {
  test('pick one recommended label per question, and none for a multi-select or an unmarked or twice-marked one', () => {
    expect(picksOf([COLOR])).toEqual({ 'Renk?': 'Mavi (Recommended)' })
    expect(picksOf([{ ...COLOR, multiSelect: true }])).toBe(undefined)
    expect(picksOf([{ question: 'x', options: [{ label: 'a (Recommended)' }, { label: 'b (Önerilen)' }] }])).toBe(undefined)
    expect(picksOf([{ question: 'x' }])).toBe(undefined)
  })

  test('the recommended option is the first one, marked at its end in any known language', () => {
    for (const label of ['Blau (Empfohlen)', 'Azul (recomendado)', 'Bleu (Recommandé)', '青（推荐）', 'Синий (Рекомендуется)', 'Mavi ( Önerilen ) ']) {
      expect(picksOf([{ question: 'q', options: [{ label }, { label: 'b' }] }]), label).toEqual({ q: label })
    }
    // A marked option that is not the first, a mark inside the label, and a parenthesis of another word are not picked.
    for (const options of [[{ label: 'a' }, { label: 'b (Recommended)' }], [{ label: '(Recommended) a' }, { label: 'b' }], [{ label: 'Mavi (koyu)' }, { label: 'b' }]]) {
      expect(picksOf([{ question: 'q', options }]), JSON.stringify(options)).toBe(undefined)
    }
  })

  test('the sidebar draws each picked answer yellow and the rest faint, and a waiting question yellow', () => {
    const answers = { 'Renk?': 'Mavi (Recommended)', 'Boyut?': 'Büyük (Önerilen)' }
    expect(pickedLine(10, answers)).toEqual({
      text: pickedLog(10, answers),
      kind: 'warn',
      parts: [
        { text: 'no answer in 10 min, picked the recommended option: ', kind: 'dim' },
        { text: 'Renk? → ', kind: 'dim' },
        { text: 'Mavi (Recommended)', kind: 'warn' },
        { text: '; ', kind: 'dim' },
        { text: 'Boyut? → ', kind: 'dim' },
        { text: 'Büyük (Önerilen)', kind: 'warn' },
      ],
    })
    expect(waitsLine(10)).toEqual({ text: waitsLog(10), kind: 'warn' })
  })
})
