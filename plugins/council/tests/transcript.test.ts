import { describe, expect, test, tier } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { renderTranscript } from '../hooks/transcript.ts'

tier('user')

const call = (n: number, output: string): SessionMessage[] => [
  { role: 'assistant', text: `step ${n}`, toolUses: [{ tool_use_id: `t${n}`, tool: 'Bash', input: { command: `run ${n}` } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: `t${n}`, text: output, isError: false }] },
]

describe('transcript', () => {
  test('a conversation under the limit is sent whole', () => {
    const text = renderTranscript([{ role: 'user', text: 'hi', toolUses: [] }, ...call(1, 'ok')], 10_000)
    expect(text).toBe('#1 user: hi\n#2 assistant: step 1\n  [call] Bash {"command":"run 1"}\n  output: ok\n#3 user: ')
  })

  test('over the limit the longest outputs are cut first, and every message stays', () => {
    const messages = [...call(1, 'a'.repeat(5000)), ...call(2, 'short')]
    const text = renderTranscript(messages, 2000)
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text).toContain('chars omitted')
    expect(text).toContain('output: short')
    expect(text).toContain('#1 assistant: step 1')
  })

  test('when the messages alone are over the limit, the oldest are left out and a first line counts them', () => {
    const messages = Array.from({ length: 50 }, (_, i): SessionMessage => ({ role: 'user', text: `message ${i + 1} ${'x'.repeat(100)}`, toolUses: [] }))
    const text = renderTranscript(messages, 1500)
    expect(text.length).toBeLessThanOrEqual(1500)
    expect(text.startsWith('[the first ')).toBe(true)
    expect(text).toContain('#50 user: message 50')
    expect(text).not.toContain('#1 user:')
  })

  test('one message alone over the limit is cut to its head and tail', () => {
    const text = renderTranscript([{ role: 'user', text: 'y'.repeat(10_000), toolUses: [] }], 1000)
    expect(text.length).toBeLessThan(1100)
    expect(text).toContain('chars omitted')
  })
})
