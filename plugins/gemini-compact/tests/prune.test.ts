import { describe, expect, test, tier } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { actionsByUse, applyActions, callLabel, removedNote, sizeOf, truncated } from '../hooks/apply.ts'
import { clip, collectCalls, parseDecisions, renderTranscript } from '../hooks/prune.ts'

tier('user')

const user = (text: string, results: [string, string][] = [], handle?: string): SessionMessage => ({
  role: 'user',
  text,
  toolUses: [],
  ...(results.length > 0 ? { toolResults: results.map(([id, out]) => ({ tool_use_id: id, text: out, isError: false })) } : {}),
  ...(handle === undefined ? {} : { handle }),
})

const assistant = (text: string, uses: [string, string, string][] = [], handle?: string): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses: uses.map(([id, tool, arg]) => ({ tool_use_id: id, tool, input: { command: arg }, text: `out of ${arg}` })),
  ...(handle === undefined ? {} : { handle }),
})

const BIG = 'x'.repeat(2000)

// prompt, two old calls with results, then four newest messages with one more call
const CONVERSATION: SessionMessage[] = [
  user('Fix the bug.', [], 'h0'),
  assistant('Reading.', [['t1', 'Bash', 'cat a.txt']], 'h1'),
  user('', [['t1', BIG]], 'h2'),
  assistant('', [['t2', 'Bash', 'ls']], 'h3'),
  user('', [['t2', 'a.txt b.txt']], 'h4'),
  assistant('Now the test.', [['t3', 'Bash', 'npm test']], 'h5'),
  user('', [['t3', 'ok']], 'h6'),
  assistant('Done.', [], 'h7'),
  user('Thanks.', [], 'h8'),
]

describe('collectCalls', () => {
  test('gives an id to each call outside the first and the newest messages, with its result', async () => {
    const calls = collectCalls(CONVERSATION, 4)
    expect(calls.map(c => [c.id, c.toolUseId, c.pinned])).toEqual([
      ['c1', 't1', false],
      ['c2', 't2', false],
      ['', 't3', true],
    ])
    expect(calls[0]?.output).toBe(BIG)
  })

  test('pins a call whose result sits in a newest message', async () => {
    expect(collectCalls(CONVERSATION, 5).map(c => c.pinned)).toEqual([false, true, true])
  })
})

describe('renderTranscript', () => {
  test('lists every message and each call with its id, input and output', async () => {
    const calls = collectCalls(CONVERSATION, 4)
    const text = renderTranscript(CONVERSATION, calls, 100_000)
    expect(text).toContain('#1 user: Fix the bug.')
    expect(text).toContain('  [c2] Bash {"command":"ls"}\n  output: a.txt b.txt')
    expect(text).toContain('  [fixed] Bash {"command":"npm test"}')
  })

  test('cuts the longest outputs to fit the limit, and throws when no output cut is enough', async () => {
    const calls = collectCalls(CONVERSATION, 4)
    const text = renderTranscript(CONVERSATION, calls, 900)
    expect(text.length).toBeLessThanOrEqual(900)
    expect(text).toContain('chars omitted')
    expect(text).toContain('output: a.txt b.txt')
    expect(() => renderTranscript(CONVERSATION, calls, 100)).toThrow('even without tool output')
  })

  test('clip keeps the head and the tail', async () => {
    expect(clip('abcdefghij', 4)).toBe('ab\n[… 6 chars omitted …]\nij')
    expect(clip('abc', 4)).toBe('abc')
  })
})

describe('parseDecisions', () => {
  const ids = ['c1', 'c2']

  test('reads one action for every id', async () => {
    const d = parseDecisions('{"decisions":[{"id":"c1","action":"drop"},{"id":"c2","action":"keep"}]}', ids)
    expect([...d]).toEqual([['c1', 'drop'], ['c2', 'keep']])
  })

  test('refuses an answer that misses, repeats or invents an id, or names another action', async () => {
    expect(() => parseDecisions('{"decisions":[{"id":"c1","action":"drop"}]}', ids)).toThrow('no decision for c2')
    expect(() => parseDecisions('{"decisions":[{"id":"c1","action":"drop"},{"id":"c1","action":"keep"},{"id":"c2","action":"keep"}]}', ids)).toThrow('decided twice')
    expect(() => parseDecisions('{"decisions":[{"id":"c9","action":"drop"}]}', ids)).toThrow('unknown call id c9')
    expect(() => parseDecisions('{"decisions":[{"id":"c1","action":"summarize"}]}', ids)).toThrow('unknown action')
    expect(() => parseDecisions('keep all', ids)).toThrow('not JSON')
    expect(() => parseDecisions('{"answer":[]}', ids)).toThrow('no decisions list')
  })
})

describe('applyActions', () => {
  const calls = collectCalls(CONVERSATION, 4)

  test('drops a call with its result and names it in a note on the nearest assistant message', async () => {
    const actions = actionsByUse(calls, new Map([['c1', 'keep'], ['c2', 'drop']]))
    const out = applyActions(CONVERSATION, actions, 300)
    expect(out.flatMap(m => m.toolUses.map(u => u.tool_use_id))).toEqual(['t1', 't3'])
    expect(out.some(m => (m.toolResults ?? []).some(r => r.tool_use_id === 't2'))).toBe(false)
    expect(out).toHaveLength(7)
    expect(out[1]?.text).toBe(`Reading.\n\n${removedNote(['Bash(ls)'])}`)
    expect(out[1]?.handle).toBe(undefined)
  })

  test('keeps an untouched message as the same object, with its handle', async () => {
    const actions = actionsByUse(calls, new Map([['c1', 'truncate'], ['c2', 'keep']]))
    const out = applyActions(CONVERSATION, actions, 300)
    expect(out[0]).toBe(CONVERSATION[0])
    expect(out[3]).toBe(CONVERSATION[3])
    expect(out).toHaveLength(9)
  })

  test('truncates both copies of an output to its head and a note, and keeps the call', async () => {
    const actions = actionsByUse(calls, new Map([['c1', 'truncate'], ['c2', 'keep']]))
    const out = applyActions(CONVERSATION, actions, 300)
    const result = out[2]?.toolResults?.[0]
    expect(result?.text.startsWith(`${'x'.repeat(300)}\n[gemini-compact cut 1700 chars`)).toBe(true)
    expect(out[1]?.toolUses[0]?.tool_use_id).toBe('t1')
    expect(sizeOf(out)).toBeLessThan(sizeOf(CONVERSATION))
  })

  test('never touches a pinned call, whatever the decisions say', async () => {
    expect(actionsByUse(calls, new Map([['', 'drop']])).size).toBe(0)
  })

  test('leaves a short output whole, and labels a call by its first string input', async () => {
    expect(truncated('short', 300)).toBe('short')
    expect(callLabel({ tool_use_id: 'x', tool: 'Read', input: { file_path: 'src/a.ts', limit: 5 } })).toBe('Read(src/a.ts)')
  })
})
