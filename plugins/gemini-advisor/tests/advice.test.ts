import { describe, expect, test, tier } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { ADVISOR_TASK, adviceText, buildAdviceRequest, messageOf, retryDelay } from '../hooks/advice.ts'
import { changeText, FREE_WARNING, parseCommand, storedValue } from '../hooks/command.ts'
import { configFrom } from '../hooks/config.ts'
import { parseResponse } from '../hooks/gemini.ts'
import { clip, renderTranscript } from '../hooks/transcript.ts'

tier('user')

describe('buildAdviceRequest', () => {
  test('posts the task, the conversation and the message with the key in a header and an output limit', async () => {
    const r = buildAdviceRequest('gemini-3.8-flash', 'KEY', 'the transcript', 'the question', 8192)
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(r.url).not.toContain('KEY')
    expect(r.init.headers['x-goog-api-key']).toBe('KEY')
    const body = JSON.parse(r.init.body)
    expect(body.generationConfig).toEqual({ maxOutputTokens: 8192 })
    expect(body.contents[0].parts[0].text).toBe(`${ADVISOR_TASK}\n\nThe conversation:\n\nthe transcript\n\nThe agent asks:\n\nthe question`)
  })
})

describe('the answer', () => {
  test('joins the text parts past a thought, and reads the token counts and the finish reason', async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Use ' }, { text: 'a lock.' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 30, thoughtsTokenCount: 70 },
    })
    expect(parseResponse(200, true, body)).toEqual({ text: 'Use a lock.', inputTokens: 900, outputTokens: 100, finishReason: 'STOP' })
  })

  test('refuses an HTTP error, an empty advice, a cut advice and a missing message', async () => {
    expect(() => parseResponse(503, false, '<html>')).toThrow('Gemini HTTP 503')
    expect(() => adviceText({ text: '  ', inputTokens: 0, outputTokens: 0 })).toThrow('empty')
    expect(() => adviceText({ text: 'Half', inputTokens: 0, outputTokens: 0, finishReason: 'MAX_TOKENS' })).toThrow('output token limit')
    expect(() => messageOf({})).toThrow('message is required')
    expect(messageOf({ message: ' why? ' })).toBe('why?')
  })
})

describe('retryDelay', () => {
  test('waits longer after each 503, and not for any other status, a fourth attempt or past the budget', async () => {
    expect(retryDelay(503, 1, 0)).toBe(2000)
    expect(retryDelay(503, 2, 5000)).toBe(4000)
    expect(retryDelay(503, 3, 0)).toBe(undefined)
    expect(retryDelay(429, 1, 0)).toBe(undefined)
    expect(retryDelay(200, 1, 0)).toBe(undefined)
    expect(retryDelay(503, 1, 29_000)).toBe(undefined)
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
    expect(parseCommand('off')).toEqual({ kind: 'set', patch: { enabled: false } })
    expect(parseCommand('model gemini-3.1-pro-preview')).toEqual({ kind: 'set', patch: { model: 'gemini-3.1-pro-preview' } })
    for (const bad of ['model', 'model ../x', 'model Gemini', 'on now', 'ask', 'at 50']) expect(parseCommand(bad).kind, bad).toBe('error')
    expect(changeText({ tier: 'free' })).toBe(FREE_WARNING)
  })

  test('ignores a stored value of the wrong type and an option out of range', async () => {
    expect(storedValue('model', 'a/b')).toBe(undefined)
    expect(storedValue('tier', 'cheap')).toBe(undefined)
    const c = configFrom({ maxOutputTokens: 10, model: 'gemini-3.5-flash', apiKey: ' ' })
    expect(c.maxOutputTokens).toBe(8192)
    expect(c.model).toBe('gemini-3.5-flash')
    expect(c.apiKey).toBe(undefined)
  })
})
