/** The Gemini generateContent request and the reading of its response. */
import { ACTIONS } from './prune.ts'
import { SUMMARY_TASK } from './summary.ts'

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

/** A model id is placed in the URL path, so only a plain id is taken. */
export const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,79}$/

export type Request = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }

/** `finishReason` is Gemini's, such as `STOP` or `MAX_TOKENS`; absent when it gave none. */
export type Answer = { text: string; inputTokens: number; outputTokens: number; finishReason?: string }

const TASK = `You decide which tool calls of a Claude Code conversation can leave its context, because the context is being compacted. Every message stays; only tool calls and their outputs can go.

For every call with an id such as [c7], answer one action:
- keep: the assistant still needs the full output (a file it is editing, an error it is fixing, data it will quote, an output that cannot be produced again).
- truncate: knowing the call ran and its input still matters, but the full output does not; only its first lines stay.
- drop: neither the call nor its output matters for what comes next (a superseded read of a file changed since, a listing or search already acted on, a passing test run, a finished side task).

Calls marked [fixed] stay whatever you answer; read them as context only. The latest user messages state the current task. When unsure, answer keep.`

function prompt(task: string, transcript: string, instructions: string | undefined): string {
  const focus = instructions === undefined || instructions.trim() === '' ? '' : `\n\nThe user asked the compaction to keep in mind: ${instructions.trim()}`
  return `${task}${focus}\n\nThe conversation:\n\n${transcript}`
}

function post(model: string, apiKey: string, body: unknown): Request {
  return {
    url: `${API}/${model}:generateContent`,
    init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) },
  }
}

/** The request that asks for a plain-text summary of the conversation. */
export function buildSummaryRequest(model: string, apiKey: string, transcript: string, maxOutputTokens: number, instructions?: string): Request {
  return post(model, apiKey, {
    contents: [{ role: 'user', parts: [{ text: prompt(SUMMARY_TASK, transcript, instructions) }] }],
    generationConfig: { maxOutputTokens },
  })
}

/** The request that asks for one action per candidate id, in a schema Gemini must follow. */
export function buildRequest(model: string, apiKey: string, transcript: string, ids: readonly string[], instructions?: string): Request {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt(TASK, transcript, instructions) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          decisions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING', enum: [...ids] },
                action: { type: 'STRING', enum: [...ACTIONS] },
              },
              required: ['id', 'action'],
            },
          },
        },
        required: ['decisions'],
      },
    },
  }
  return post(model, apiKey, body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(value: unknown, fallback: string): string {
  const error = isRecord(value) ? value.error : undefined
  const message = isRecord(error) && typeof error.message === 'string' ? error.message : fallback
  return message.replace(/\s+/g, ' ').slice(0, 200)
}

/** The answer text: the first part that is text and not a thought. */
function answerText(value: Record<string, unknown>): string | undefined {
  const candidate = Array.isArray(value.candidates) ? value.candidates[0] : undefined
  const content = isRecord(candidate) ? candidate.content : undefined
  const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : []
  const part = parts.find(p => isRecord(p) && typeof p.text === 'string' && p.thought !== true)
  return isRecord(part) ? (part.text as string) : undefined
}

function finishReason(value: Record<string, unknown>): string | undefined {
  const candidate = Array.isArray(value.candidates) ? value.candidates[0] : undefined
  const reason = isRecord(candidate) ? candidate.finishReason : undefined
  return typeof reason === 'string' ? reason : undefined
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
  const answer = answerText(value)
  if (answer === undefined) throw new Error(`Gemini gave no answer (${errorText(value, 'blocked or empty')})`)
  const reason = finishReason(value)
  return {
    text: answer,
    inputTokens: count(value.usageMetadata, 'promptTokenCount'),
    outputTokens: count(value.usageMetadata, 'candidatesTokenCount') + count(value.usageMetadata, 'thoughtsTokenCount'),
    ...(reason === undefined ? {} : { finishReason: reason }),
  }
}
