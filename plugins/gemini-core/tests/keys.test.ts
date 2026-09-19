import { describe, expect, test, tier } from 'claude-code/testing'

import { buildHttp } from '../hooks/api.ts'
import { isKeyFailure, parseKeys, readWithKeys, type KeyState } from '../hooks/keys.ts'

tier('user')

const KEYS = ['K1', 'K2', 'K3']

const quota = JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota' } })
const invalid = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })
const answer = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })

const response = (key: string, status: number, text: string, tried?: string[]) => ({
  http: { ...buildHttp('gemini-3.8-flash', key, { a: 1 }), ...(tried === undefined ? {} : { tried }) },
  status,
  ok: status < 300,
  text,
  attempt: 1,
  elapsedMs: 0,
})

describe('keys', () => {
  test('reads a comma-separated list, trimmed, without blanks or repeats', async () => {
    expect(parseKeys(' K1, K2 ,,K1 , ')).toEqual(['K1', 'K2'])
    expect(parseKeys('K1')).toEqual(['K1'])
    expect(parseKeys(undefined)).toEqual([])
  })

  test('only a quota or a key Google refuses moves to another key; a 503 or a bad request does not', async () => {
    expect(isKeyFailure(429, quota)).toBe(true)
    expect(isKeyFailure(403, '{}')).toBe(true)
    expect(isKeyFailure(401, '{}')).toBe(true)
    expect(isKeyFailure(400, invalid)).toBe(true)
    expect(isKeyFailure(400, JSON.stringify({ error: { message: 'Thinking level MINIMAL is not supported' } }))).toBe(false)
    expect(isKeyFailure(503, '{}')).toBe(false)
  })

  test('a key failure sends the same request with the next key at once, and the next request starts there', async () => {
    const state: KeyState = { preferred: 0 }
    const read = readWithKeys(response('K1', 429, quota), KEYS, state)
    if (!('next' in read)) throw new Error(JSON.stringify(read))
    expect(read.next.init.headers['x-goog-api-key']).toBe('K2')
    expect(read.next.init.body).toBe('{"a":1}')
    expect(read.next.url).toContain('/gemini-3.8-flash:generateContent')
    expect(read.next.tried).toEqual(['key 1: Gemini HTTP 429: You exceeded your current quota'])
    expect(state.preferred).toBe(1)
  })

  test('wraps from the last key to the first, and names every key\'s failure once each has failed', async () => {
    const state: KeyState = { preferred: 2 }
    const first = readWithKeys(response('K3', 400, invalid), KEYS, state)
    if (!('next' in first)) throw new Error(JSON.stringify(first))
    expect(first.next.init.headers['x-goog-api-key']).toBe('K1')
    const tried = ['key 3: Gemini HTTP 400: API key not valid. Please pass a valid API key.', 'key 1: Gemini HTTP 429: You exceeded your current quota']
    expect(readWithKeys(response('K2', 429, quota, tried), KEYS, state)).toEqual({
      error: 'all 3 keys failed: Gemini HTTP 400: API key not valid. Please pass a valid API key. (key 3); Gemini HTTP 429: You exceeded your current quota (keys 1-2)',
    })
  })

  test('names each distinct failure once with its keys, so 34 keys give a short error', async () => {
    const keys = Array.from({ length: 34 }, (_, i) => `K${i + 1}`)
    const tried = keys.slice(0, 33).map((_, i) => `key ${i + 1}: ${i === 4 || i === 9 ? 'Gemini HTTP 400: API key not valid.' : 'Gemini HTTP 429: quota'}`)
    const read = readWithKeys(response('K34', 429, JSON.stringify({ error: { message: 'quota' } }), tried), keys, { preferred: 33 })
    expect(read).toEqual({ error: 'all 34 keys failed: Gemini HTTP 429: quota (keys 1-4, 6-9, 11-34); Gemini HTTP 400: API key not valid. (keys 5, 10)' })
  })

  test('moves to no further key once the deadline has passed', async () => {
    const late = { ...response('K1', 429, quota), elapsedMs: 40_000, deadlineMs: 40_000 }
    expect(readWithKeys(late, KEYS, { preferred: 0 })).toEqual({ error: '1 of 3 keys failed before the deadline: Gemini HTTP 429: You exceeded your current quota (key 1)' })
  })

  test('one key reads as before, and a success remembers the key it came from', async () => {
    const state: KeyState = { preferred: 0 }
    expect(readWithKeys(response('K1', 429, quota), ['K1'], state)).toEqual({ error: 'Gemini HTTP 429: You exceeded your current quota' })
    expect(readWithKeys(response('K3', 200, answer), KEYS, state)).toEqual({ answer: { text: 'hi', inputTokens: 0, outputTokens: 0 } })
    expect(state.preferred).toBe(2)
    expect(readWithKeys(response('K1', 503, '{}'), KEYS, state)).toEqual({ retryInMs: 1000 })
  })
})
