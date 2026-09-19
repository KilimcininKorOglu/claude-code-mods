/** The Gemini generateContent request envelope and the reading of its response. */

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

/** A model id is placed in the URL path, so only a plain id is taken. */
export const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,79}$/

export type Request = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }

/** `finishReason` is Gemini's, such as `STOP` or `MAX_TOKENS`; absent when it gave none. */
export type Answer = { text: string; inputTokens: number; outputTokens: number; finishReason?: string }

/** A POST to the model with the key in a header, never in the URL. */
export function post(model: string, apiKey: string, body: unknown): Request {
  return {
    url: `${API}/${model}:generateContent`,
    init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) },
  }
}

/**
 * Gemini answers 503 ("high demand") now and then, often after 10 s or more,
 * and the next request often works (measured). A hook's 10 s budget counts
 * its `$.clock` waits but not its requests, so the waits stay short and the
 * attempts many. No new attempt starts once 60 s passed.
 */
export const RETRY = { delaysMs: [1000, 2000, 3000], budgetMs: 60_000 }

/** The wait before the next attempt, or undefined when the answer stands. */
export function retryDelay(status: number, attempt: number, elapsedMs: number): number | undefined {
  const delay = RETRY.delaysMs[attempt - 1]
  if (status !== 503 || delay === undefined) return undefined
  return elapsedMs + delay < RETRY.budgetMs ? delay : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(value: unknown, fallback: string): string {
  const error = isRecord(value) ? value.error : undefined
  const message = isRecord(error) && typeof error.message === 'string' ? error.message : fallback
  return message.replace(/\s+/g, ' ').slice(0, 200)
}

function firstCandidate(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value.candidates) ? value.candidates[0] : undefined
  return isRecord(candidate) ? candidate : undefined
}

/** The answer text: every part that is text and not a thought, joined. */
function answerText(candidate: Record<string, unknown> | undefined): string | undefined {
  const content = candidate?.content
  const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : []
  const texts = parts.filter(p => isRecord(p) && typeof p.text === 'string' && p.thought !== true).map(p => (p as { text: string }).text)
  return texts.length === 0 ? undefined : texts.join('')
}

function count(usage: unknown, key: string): number {
  const n = isRecord(usage) ? usage[key] : undefined
  return typeof n === 'number' ? n : 0
}

/** Reads a generateContent response; an HTTP error, a blocked or empty answer throws. */
export function parseResponse(status: number, ok: boolean, text: string): Answer {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(ok ? 'Gemini answered with no JSON' : `Gemini HTTP ${status}`)
  }
  if (!ok) throw new Error(`Gemini HTTP ${status}: ${errorText(value, 'no message')}`)
  if (!isRecord(value)) throw new Error('Gemini answered with no object')
  const candidate = firstCandidate(value)
  const answer = answerText(candidate)
  if (answer === undefined) throw new Error(`Gemini gave no answer (${errorText(value, 'blocked or empty')})`)
  const reason = candidate?.finishReason
  return {
    text: answer,
    inputTokens: count(value.usageMetadata, 'promptTokenCount'),
    outputTokens: count(value.usageMetadata, 'candidatesTokenCount') + count(value.usageMetadata, 'thoughtsTokenCount'),
    ...(typeof reason === 'string' ? { finishReason: reason } : {}),
  }
}
