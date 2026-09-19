/** The generateContent bodies this mod sends; gemini-core builds the request around them and reads the answer. */
import type { EngineInterface } from 'claude-code'
import { ACTIONS } from './prune.ts'
import { SUMMARY_TASK } from './summary.ts'

/** Gemini's answer as gemini-core reads it; `finishReason` is Gemini's, such as `STOP` or `MAX_TOKENS`. */
export type Answer = Extract<Awaited<ReturnType<EngineInterface['gemini']['read']>>, { answer: unknown }>['answer']

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

/** The body that asks for a plain-text summary of the conversation. */
export function buildSummaryBody(transcript: string, maxOutputTokens: number, instructions?: string): Record<string, unknown> {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt(SUMMARY_TASK, transcript, instructions) }] }],
    generationConfig: { maxOutputTokens },
  }
}

/** The body that asks for one action per candidate id, in a schema Gemini must follow. */
export function buildPruneBody(transcript: string, ids: readonly string[], instructions?: string): Record<string, unknown> {
  return {
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
}
