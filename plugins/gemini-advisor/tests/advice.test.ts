import { describe, expect, test, tier } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { ADVISOR_TASK, adviceText, buildAdviceBody, messageOf } from '../hooks/advice.ts'
import { parseCommand } from '../hooks/command.ts'
import { configFrom } from '../hooks/config.ts'
import { clip, renderTranscript } from '../hooks/transcript.ts'

tier('user')

describe('buildAdviceBody', () => {
  test('holds the task, the conversation and the message, and an output limit', async () => {
    const body = JSON.parse(JSON.stringify(buildAdviceBody('the transcript', 'the question', 8192)))
    expect(body.generationConfig).toEqual({ maxOutputTokens: 8192 })
    expect(body.contents[0].parts[0].text).toBe(`${ADVISOR_TASK}\n\nThe conversation:\n\nthe transcript\n\nThe agent asks:\n\nthe question`)
  })
})

describe('the answer', () => {
  test('refuses an empty advice, a cut advice and a missing message', async () => {
    expect(() => adviceText({ text: '  ', inputTokens: 0, outputTokens: 0 })).toThrow('empty')
    expect(() => adviceText({ text: 'Half', inputTokens: 0, outputTokens: 0, finishReason: 'MAX_TOKENS' })).toThrow('output token limit')
    expect(() => messageOf({})).toThrow('message is required')
    expect(messageOf({ message: ' why? ' })).toBe('why?')
  })
})

describe('renderTranscript', () => {
  const big = 'x'.repeat(3000)
  const messages: SessionMessage[] = [
    { role: 'user', text: 'Go.', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'a.ts' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: big, isError: false }] },
  ]

  test('lists each message and each call with its output', async () => {
    const text = renderTranscript(messages, 100_000)
    expect(text).toContain('#1 user: Go.')
    expect(text).toContain(`  [call] Read {"file_path":"a.ts"}\n  output: ${big}`)
  })

  test('cuts the longest outputs to fit, and throws when even no output does not fit', async () => {
    expect(renderTranscript(messages, 500).length).toBeLessThanOrEqual(500)
    expect(() => renderTranscript(messages, 20)).toThrow('even without tool output')
    expect(clip('abcdefghij', 4)).toBe('ab\n[… 6 chars omitted …]\nij')
  })
})

describe('settings', () => {
  test('reads every command form and refuses the rest', async () => {
    expect(parseCommand('')).toEqual({ kind: 'status' })
    expect(parseCommand('off')).toEqual({ kind: 'set', enabled: false })
    for (const bad of ['model gemini-3.5-flash', 'paid', 'on now', 'ask']) expect(parseCommand(bad).kind, bad).toBe('error')
  })

  test('replaces an option out of range by its default', async () => {
    expect(configFrom({ maxOutputTokens: 10 }).maxOutputTokens).toBe(8192)
    expect(configFrom({ maxInputChars: 50_000 }).maxInputChars).toBe(50_000)
  })
})
