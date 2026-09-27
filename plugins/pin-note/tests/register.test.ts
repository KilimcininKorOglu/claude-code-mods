import { describe, expect, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { parseArgs } from '../hooks/pins.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'pin-note', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** `store` is the mod's store; `logs` holds the transcript lines. */
type World = { store: Record<string, unknown>; logs: string[] }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { store: { ...store }, logs: [] }
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('classic.SessionStart', () => ({}))
  return w
}

const started = ($: Engine) => $.session.start({ surface: null, isInteractive: true, cwd: '/w' })
const command = async ($: Engine, args: string): Promise<string> => (await $.command.run(run(args))).text ?? ''
const restart = ($: Engine, source: 'startup' | 'resume' | 'clear' | 'compact', sessionId = 's1') =>
  $.classic.SessionStart({ source, session_id: sessionId } as never) as Promise<{ additionalContext?: string[] }>

describe('arguments', () => {
  test('on, off and drop <n> are commands, and any other text is a note kept as typed', () => {
    expect(parseArgs('')).toEqual({ kind: 'list' })
    expect(parseArgs(' on ')).toEqual({ kind: 'enable', on: true })
    expect(parseArgs('drop 2')).toEqual({ kind: 'drop', index: 2 })
    expect(parseArgs('drop the old table first')).toEqual({ kind: 'add', text: 'drop the old table first' })
    expect(parseArgs('always ask before a push\nand before a deploy')).toEqual({ kind: 'add', text: 'always ask before a push\nand before a deploy' })
  })
})

describe('pin-note', () => {
  test('is off after an install: a note is refused and nothing is sent again', async ($, on) => {
    const w = world(on)
    await started($)
    expect(await command($, 'ask before a push')).toBe('off: turn it on with /pin-note on first')
    expect(await command($, '')).toBe('off: /pin-note on to pin notes and have them sent again · no pinned notes')
    expect((await restart($, 'compact')).additionalContext).toBeUndefined()
    expect(w.store).toEqual({})
  })

  test('pinned notes go to the model word for word after a compaction and /clear, not at a resume', async ($, on) => {
    const w = world(on)
    await started($)
    await command($, 'on')
    expect(await command($, 'ask before a push')).toBe('pinned note 1, kept for this session and sent to you again after each compaction and /clear:\nask before a push')
    await command($, 'answer in Turkish')
    const compacted = await restart($, 'compact')
    expect(compacted.additionalContext).toEqual(['pin-note: the person pinned these notes for this session; they are still in force, follow them:\n1. ask before a push\n2. answer in Turkish'])
    expect(w.logs).toEqual(['sent 2 pinned note(s) again after the compaction'])
    // /clear starts a new session, and the notes go with it.
    expect((await restart($, 'clear', 's2')).additionalContext?.[0]).toContain('2. answer in Turkish')
    expect(w.store['pins:s2']).toEqual(['ask before a push', 'answer in Turkish'])
    expect((await restart($, 'resume', 's2')).additionalContext).toBeUndefined()
  })

  test('drop takes a note out by its number, and the list shows what is left', async ($, on) => {
    const w = world(on, { enabled: true })
    await started($)
    await command($, 'one')
    await command($, 'two')
    expect(await command($, 'drop 1')).toBe('dropped note 1; it is no longer in force:\none')
    expect(await command($, 'drop 5')).toBe('there is no note 5: notes 1 to 1 are pinned')
    expect(await command($, '')).toBe('on · 1 pinned note(s):\n1. two')
    expect(w.store['pins:s1']).toEqual(['two'])
    await command($, 'drop 1')
    expect((await restart($, 'compact')).additionalContext).toBeUndefined()
  })

  test('a reloaded module or a resumed session takes the notes stored for its session', async ($, on) => {
    world(on, { enabled: true, 'pins:s1': ['kept'], 'pins:old': ['from before'] })
    await started($)
    expect(await command($, '')).toBe('on · 1 pinned note(s):\n1. kept')
    await restart($, 'resume', 'old')
    expect(await command($, '')).toBe('on · 1 pinned note(s):\n1. from before')
  })

  test('off keeps the notes but sends none', async ($, on) => {
    world(on, { enabled: true, 'pins:s1': ['kept'] })
    await started($)
    expect(await command($, 'off')).toBe('off: /pin-note on to pin notes and have them sent again · 1 pinned note(s):\n1. kept')
    expect((await restart($, 'compact')).additionalContext).toBeUndefined()
  })
})
