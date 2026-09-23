import { describe, expect, test, tier } from 'claude-code/testing'
import { cancelledText, parseChain, statusText, stoppedText, thrownWhy } from '../hooks/chain.ts'

tier('user')

describe('parseChain', () => {
  test('splits at each && /<name> and keeps each command its own arguments', () => {
    expect(parseChain('&& /context')).toEqual({ head: '', rest: [{ command: 'context', args: '' }] })
    expect(parseChain('fix the bug && /review src && /plugin:cmd a b')).toEqual({
      head: 'fix the bug',
      rest: [{ command: 'review', args: 'src' }, { command: 'plugin:cmd', args: 'a b' }],
    })
  })

  test('leaves a && that no /<name> follows in the arguments', () => {
    expect(parseChain('build && test')).toEqual({ head: 'build && test', rest: [] })
    expect(parseChain('a&&/b')).toEqual({ head: 'a&&/b', rest: [] })
    expect(parseChain('')).toEqual({ head: '', rest: [] })
  })
})

describe('texts', () => {
  test('a stop names what did not run, and the status names what the chain waits for', () => {
    expect(stoppedText({ command: 'a', args: '' }, 'it failed: x', [{ command: 'b', args: '' }, { command: 'c', args: '1' }])).toBe('stopped after /a: it failed: x; not run: /b, /c')
    // The last step names nothing after it, and the engine's plugin prefix on the error is not repeated.
    expect(stoppedText({ command: 'x', args: '' }, thrownWhy(new Error('slash-chain: $.command.run: no command named /x in this session')), [])).toBe('stopped after /x: it failed: $.command.run: no command named /x in this session')
    expect(cancelledText([])).toBe('cancelled')
    expect(statusText(true, undefined)).toBe('on · no chain runs')
    expect(statusText(false, { step: { command: 'tiny', args: 'x' }, index: 1, total: 2, wait: 'turn' })).toBe('off · 1/2 /tiny x, waiting for its turn')
  })
})
