import { describe, expect, test, tier } from 'claude-code/testing'

import { buildHttp, parseResponse, readResponse, retryDelay, withThinking } from '../hooks/api.ts'
import { parseCommand, resolveConsumer, statusText } from '../hooks/settings.ts'

tier('user')

const ok = (text: string, finishReason = 'STOP') =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thought', thought: true }, { text }] }, finishReason }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 } })

describe('the request', () => {
  test('adds the thinking level beside the rest of generationConfig, and nothing without one', async () => {
    const body = { contents: [], generationConfig: { responseMimeType: 'application/json' } }
    expect(withThinking(body, 'low')).toEqual({ contents: [], generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } } })
    expect(withThinking({ contents: [] }, 'high')).toEqual({ contents: [], generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } })
    expect(withThinking(body, undefined)).toBe(body)
  })

  test('puts the key in a header, never in the URL', async () => {
    const http = buildHttp('gemini-3.8-flash', 'KEY', { a: 1 })
    expect(http.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(http.init.headers['x-goog-api-key']).toBe('KEY')
    expect(http.init.body).toBe('{"a":1}')
  })
})

describe('the response', () => {
  test('reads the answer without the thoughts, and counts thinking as output', async () => {
    expect(parseResponse(200, true, ok('hi'))).toEqual({ text: 'hi', inputTokens: 10, outputTokens: 10, finishReason: 'STOP' })
  })

  test('an HTTP error carries Gemini\'s message, such as an unsupported thinking level', async () => {
    const text = JSON.stringify({ error: { message: 'Thinking level MINIMAL is not supported for this model.' } })
    expect(readResponse({ status: 400, ok: false, text, attempt: 1, elapsedMs: 0 })).toEqual({ error: 'Gemini HTTP 400: Thinking level MINIMAL is not supported for this model.' })
    expect(readResponse({ status: 200, ok: true, text: '{}', attempt: 1, elapsedMs: 0 })).toEqual({ error: 'Gemini gave no answer (blocked or empty)' })
  })

  test('asks again after a 503 with short waits, at most four attempts, and not past the deadline', async () => {
    const busy = { status: 503, ok: false, text: JSON.stringify({ error: { message: 'high demand' } }), elapsedMs: 0 }
    expect([1, 2, 3].map(attempt => readResponse({ ...busy, attempt }))).toEqual([{ retryInMs: 1000 }, { retryInMs: 2000 }, { retryInMs: 3000 }])
    expect(readResponse({ ...busy, attempt: 4 })).toEqual({ error: 'Gemini HTTP 503: high demand' })
    expect(retryDelay(503, 1, 59_500)).toBe(undefined)
    expect(retryDelay(503, 1, 40_000, 45_000)).toBe(1000)
    expect(retryDelay(503, 2, 44_000, 45_000)).toBe(undefined)
    expect(retryDelay(500, 1, 0)).toBe(undefined)
  })
})

describe('the command', () => {
  test('reads the tier, a mod\'s model and thinking level, and refuses the rest', async () => {
    expect(parseCommand('')).toEqual({ kind: 'status' })
    expect(parseCommand('paid')).toEqual({ kind: 'change', change: { tier: 'paid' } })
    expect(parseCommand('model review gemini-3.7-flash')).toEqual({ kind: 'change', change: { consumer: 'review', model: 'gemini-3.7-flash' } })
    expect(parseCommand('thinking review low')).toEqual({ kind: 'change', change: { consumer: 'review', thinking: 'low' } })
    expect(parseCommand('thinking review default')).toEqual({ kind: 'change', change: { consumer: 'review', thinking: null } })
    expect(parseCommand('thinking review max')).toEqual({ kind: 'error', text: 'thinking level max is not one of minimal, low, medium, high, default' })
    expect(parseCommand('model review x/y').kind).toBe('error')
    expect(parseCommand('paid now').kind).toBe('error')
  })

  test('names a mod in full or without gemini-, and prints each mod', async () => {
    expect(resolveConsumer('review', ['gemini-review'])).toBe('gemini-review')
    expect(resolveConsumer('gemini-review', ['gemini-review'])).toBe('gemini-review')
    expect(resolveConsumer('compact', ['gemini-review'])).toBe(undefined)
    expect(statusText('free', false, [])).toBe('free tier · no key: set GEMINI_API_KEY or the gemini-core apiKey option\nno Gemini mod has enrolled yet')
  })
})
