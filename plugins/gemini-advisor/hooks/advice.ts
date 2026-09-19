/** The advise tool as the model sees it, and the question Gemini is asked. */
import type { EngineInterface } from 'claude-code'

/** Gemini's answer as gemini-core reads it. */
export type Answer = Extract<Awaited<ReturnType<EngineInterface['gemini']['read']>>, { answer: unknown }>['answer']

export const TOOL_NAME = 'advise'

export const TOOL_ID = `mcp__gemini-advisor__${TOOL_NAME}` as const

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'What you did or are about to do, what you found, and the specific question you want a second opinion on.',
    },
  },
  required: ['message'],
}

const WHEN = [
  'The user installed this advisor and wants it used. Calling it at these moments is required, not optional; the user does not have to ask:',
  '- before you present or start a substantial change or a multi-step plan: call it with the plan, then present the plan;',
  '- when you are stuck: the same error twice, or an approach that keeps failing;',
  '- when you choose between two approaches: call it before you give the user your choice;',
  '- before you tell the user the work is done, with what you did and how you checked it.',
  'Skip it only for simple, mechanical steps, or when the user said not to use tools. The advice can be wrong: check it against the code before you act on it, and tell the user where you disagree.',
]

/** What the model reads about the tool: what it is, and when to call it. */
export function toolDescription(model: string): string {
  return [
    `Ask Gemini (${model}), a second model, for advice. It reads the whole conversation so far, tool calls and outputs included, and your message, and answers with a second opinion.`,
    ...WHEN,
  ].join('\n')
}

/**
 * The system prompt's note about the tool. The engine lists the tool behind
 * ToolSearch, so the model would see its name alone; this names the model
 * nowhere, so a model change does not alter the prompt.
 */
export const SYSTEM_GUIDANCE = [
  '# Gemini advisor',
  `You have a second-opinion tool, ${TOOL_ID}: Gemini reads the whole conversation so far, tool calls and outputs included, and your message, and answers with advice. When it is listed only by name, load it with ToolSearch (query "select:${TOOL_ID}").`,
  ...WHEN,
].join('\n')

export const ADVISOR_TASK = `You advise a coding agent (Claude, in Claude Code) that is working with a user. Below is its conversation so far: the user's messages, the agent's replies, and each tool call it made with the output. After it, the agent asks you for advice.

Give a second opinion the agent can act on:
- Answer the agent's question directly first.
- Point out mistakes, risks, missed steps and wrong assumptions, each with the evidence in the conversation (a file, an output, a user message).
- Say so when the plan or the work is sound; do not invent problems.
- Prefer concrete next steps over general advice. Keep it short.
- Do not state as fact anything the conversation does not show; say what the agent should check instead.
- Answer in the language of the agent's message.`

/** The generateContent body asking for advice on the agent's message, with the conversation when there is one. */
export function buildAdviceBody(transcript: string | undefined, message: string, maxOutputTokens: number): Record<string, unknown> {
  const conversation = transcript === undefined ? 'The conversation is not available; only the agent\'s message is.' : `The conversation:\n\n${transcript}`
  return {
    contents: [{ role: 'user', parts: [{ text: `${ADVISOR_TASK}\n\n${conversation}\n\nThe agent asks:\n\n${message}` }] }],
    generationConfig: { maxOutputTokens },
  }
}

/** The advice; an empty one or one Gemini cut at its output limit throws. */
export function adviceText(answer: Answer): string {
  if (answer.finishReason === 'MAX_TOKENS') throw new Error('the advice hit the output token limit (raise maxOutputTokens)')
  const text = answer.text.trim()
  if (text === '') throw new Error('the advice is empty')
  return text
}

/** The model's message from the tool input; a missing or empty one throws. */
export function messageOf(input: Record<string, unknown>): string {
  const message = input.message
  if (typeof message !== 'string' || message.trim() === '') throw new Error('message is required: what you did and the question')
  return message.trim()
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** `asked gemini-3.8-flash · 58 messages · 312k in, 1k out`; `message only` when no conversation was sent. */
export function usageText(model: string, messages: number | undefined, answer: Answer): string {
  const sent = messages === undefined ? 'message only' : `${messages} messages`
  return `asked ${model} · ${sent} · ${tokens(answer.inputTokens)} in, ${tokens(answer.outputTokens)} out`
}
