/** Several Gemini keys, tried in turn: which failures move to the next key, and the reading that does it. */
import type { GeminiHttp, GeminiRead, GeminiResponse } from '../types/index.d.ts'
import { readResponse, RETRY } from './api.ts'

/** The keys of a comma-separated list, trimmed, without blanks or repeats, in order. */
export function parseKeys(text: string | undefined): string[] {
  const keys = (text ?? '').split(',').map(k => k.trim()).filter(k => k !== '')
  return [...new Set(keys)]
}

/**
 * A failure another key can fix: a quota (429) or a key Google refuses
 * (401, 403, or 400 "API key not valid"). A 503 is the model's load, the same
 * for every key, so it is not one.
 */
export function isKeyFailure(status: number, text: string): boolean {
  if (status === 429 || status === 401 || status === 403) return true
  return status === 400 && /API_KEY_INVALID|API key not valid|API key expired/.test(text)
}

/** The index of the key the request was sent with, or -1 when it is not in the list. */
export function keyIndex(http: GeminiHttp, keys: readonly string[]): number {
  return keys.indexOf(http.init.headers['x-goog-api-key'] ?? '')
}

/** The same request with another key, carrying why the earlier ones failed. */
export function withKey(http: GeminiHttp, key: string, tried: readonly string[]): GeminiHttp {
  return { url: http.url, init: { ...http.init, headers: { ...http.init.headers, 'x-goog-api-key': key } }, tried }
}

/** The error text of a failed response, as `read` words it. */
function failureText(r: GeminiResponse): string {
  const read = readResponse({ ...r, attempt: Number.MAX_SAFE_INTEGER })
  return 'error' in read ? read.error : `Gemini HTTP ${r.status}`
}

/** In memory only: the key the last request succeeded or moved on with, where the next request starts. */
export type KeyState = { preferred: number }

/** A `tried` entry: the key's place and its failure. */
const TRIED = /^key (\d+): (.*)$/s

/**
 * The key failures of one request, each distinct failure once with the keys
 * that got it, so a long key list gives a short error:
 * `Gemini HTTP 429: quota (keys 1-3, 5); Gemini HTTP 400: API key not valid (key 4)`.
 */
export function failuresText(tried: readonly string[]): string {
  const byText = new Map<string, number[]>()
  for (const entry of tried) {
    const [, place, text] = TRIED.exec(entry) ?? [entry, '0', entry]
    byText.set(text ?? entry, [...(byText.get(text ?? entry) ?? []), Number(place)])
  }
  return [...byText].map(([text, places]) => `${text} (${placesText(places)})`).join('; ')
}

/** `key 4`, or `keys 1-3, 5`. */
function placesText(places: readonly number[]): string {
  const sorted = [...places].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (sorted[j + 1] === (sorted[j] ?? 0) + 1) j++
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`)
    i = j + 1
  }
  return `${sorted.length === 1 ? 'key' : 'keys'} ${runs.join(', ')}`
}

/**
 * Reads a response knowing the keys: a key failure moves to the next key in
 * turn (wrapping, each key once per request, none once the deadline passed);
 * when no key is left, the error names the failures by the keys' places in
 * the list, never the keys.
 */
export function readWithKeys(r: GeminiResponse, keys: readonly string[], state: KeyState): GeminiRead {
  const index = keyIndex(r.http, keys)
  if (index >= 0 && isKeyFailure(r.status, r.text)) return afterKeyFailure(r, keys, state, index)
  const read = readResponse(r)
  if ('answer' in read && index >= 0) state.preferred = index
  return read
}

/** The next key for the same request, or the error when none is left or the deadline passed. */
function afterKeyFailure(r: GeminiResponse, keys: readonly string[], state: KeyState, index: number): GeminiRead {
  const tried = [...(r.http.tried ?? []), `key ${index + 1}: ${failureText(r)}`]
  if (keys.length === 1) return { error: failureText(r) }
  if (tried.length >= keys.length) return { error: `all ${keys.length} keys failed: ${failuresText(tried)}` }
  if (r.elapsedMs >= (r.deadlineMs ?? RETRY.deadlineMs)) return { error: `${tried.length} of ${keys.length} keys failed before the deadline: ${failuresText(tried)}` }
  const next = (index + 1) % keys.length
  const key = keys[next]
  if (key === undefined) return { error: `no key at place ${next + 1} of ${keys.length}` }
  state.preferred = next
  return { next: withKey(r.http, key, tried) }
}
