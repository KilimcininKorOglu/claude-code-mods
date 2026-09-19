/** Several Gemini keys, tried in turn: which failures move to the next key, and the reading that does it. */
import type { GeminiHttp, GeminiRead, GeminiResponse } from '../types/index.d.ts'
import { readResponse } from './api.ts'

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

/**
 * Reads a response knowing the keys: a key failure moves to the next key in
 * turn (wrapping, each key once per request); when every key failed, the
 * error names each key's failure by its place in the list, never the key.
 */
export function readWithKeys(r: GeminiResponse, keys: readonly string[], state: KeyState): GeminiRead {
  const index = keyIndex(r.http, keys)
  if (index < 0 || !isKeyFailure(r.status, r.text)) {
    const read = readResponse(r)
    if ('answer' in read && index >= 0) state.preferred = index
    return read
  }
  const tried = [...(r.http.tried ?? []), `key ${index + 1}: ${failureText(r)}`]
  if (tried.length >= keys.length) return { error: keys.length === 1 ? failureText(r) : `all ${keys.length} keys failed: ${tried.join('; ')}` }
  const next = (index + 1) % keys.length
  const key = keys[next]
  if (key === undefined) return { error: `no key at place ${next + 1} of ${keys.length}` }
  state.preferred = next
  return { next: withKey(r.http, key, tried) }
}
