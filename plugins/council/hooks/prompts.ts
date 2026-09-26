/** The convene tool as the model sees it, what each member and the chair are asked, and the answer the caller reads. */

export const TOOL_NAME = 'convene'

export const TOOL_ID = `mcp__council__${TOOL_NAME}` as const

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description: 'The problem, what you tried and what you found, and the specific question you want the council to answer.',
    },
  },
  required: ['question'],
}

const WHEN = [
  'Call it when you are stuck, not for routine work:',
  '- the same error survived two attempts to fix it;',
  '- the root cause is still unclear after you investigated;',
  '- you must choose between two designs that each have real trade-offs;',
  '- before a change that is hard to undo.',
  'Skip it for simple, mechanical steps. The answers can be wrong: check them against the code before you act, and tell the user where you disagree.',
]

/** What the model reads about the tool. It names no model, so a change of the members does not make it stale. */
export const TOOL_DESCRIPTION = [
  'Convene a council of models on a hard problem. Several models read the conversation so far and your question and answer on their own; then the model of this session, as the chair, writes one verdict from their answers. You get the verdict and every answer. A call takes about half a minute.',
  ...WHEN,
].join('\n')

/** The system prompt's note about the tool; the text is fixed, so the prompt cache holds. */
export const SYSTEM_GUIDANCE = [
  '# Council',
  `You have a council tool, ${TOOL_ID}: several models answer your question on their own and the model of this session writes one verdict from their answers. When it is listed only by name, load it with ToolSearch (query "select:${TOOL_ID}").`,
  ...WHEN,
].join('\n')

const ANSWER_RULES = `Answer on your own; the other members do not see your answer:
- Answer the question directly first.
- Name the evidence for each claim: a file, an output, a message of the conversation.
- Point out mistakes, risks, missed steps and wrong assumptions. Say so when the plan is sound; do not invent problems.
- Prefer concrete next steps over general advice. Keep it short.
- Do not state as fact what the conversation does not show; say what the agent should check instead.
- Answer in the language of the question.`

/** A member's system prompt when it reads the conversation as text. */
export const MEMBER_SYSTEM = `You are one member of a council of models that advises a coding agent (Claude, in Claude Code) working with a user. You get the agent's conversation so far (the user's messages, the agent's replies, each tool call with its output) and then the agent's question.

${ANSWER_RULES}`

/** A member's prompt: the conversation when there is one, then the question. */
export function memberPrompt(transcript: string | undefined, question: string): string {
  const conversation = transcript === undefined ? 'The conversation is not available; only the question is.' : `The conversation:\n\n${transcript}`
  return `${conversation}\n\nThe agent asks the council:\n\n${question}`
}

/** A member's prompt when it forks the session and reads the conversation itself. */
export function forkMemberPrompt(question: string): string {
  return `You are now one member of a council of models that the agent convened. Do not call any tool; answer in text. The conversation above is the one to judge.

${ANSWER_RULES}

The question:

${question}`
}

/** One member's answer as the chair reads it: a letter in place of the model's name. */
export type Lettered = { letter: string; text: string }

export function letterOf(index: number): string {
  return String.fromCharCode(65 + index)
}

/** The chair's prompt; the members are letters, so the chair judges the answers and not the models. */
export function chairPrompt(question: string, answers: readonly Lettered[], hasConversation: boolean): string {
  const context = hasConversation ? 'the evidence in this conversation' : 'the question and the answers'
  const body = answers.map(a => `Member ${a.letter}:\n${a.text}`).join('\n\n')
  return `You chair a council of models that the agent convened. Do not call any tool; answer in text. ${answers.length} members answered the question below on their own; their answers follow, named by letter.

Write the council's verdict for the agent:
- where the members agree;
- where they disagree, and which side ${context} supports;
- what the members missed;
- the next step you recommend.
Start with the verdict itself, without a title. Name members by letter. Keep it short. Answer in the language of the question.

The question:

${question}

${body}`
}

/** How one member's run ended, as the caller reads it. */
export type Row = { letter?: string; label: string; ms?: number; text?: string; why?: string }

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`
}

function rowText(r: Row): string {
  if (r.text === undefined) return `## ${r.label} · no answer: ${r.why ?? 'unknown'}`
  return `## ${r.letter ?? '?'}: ${r.label} · ${seconds(r.ms ?? 0)}\n\n${r.text}`
}

/** The verdict when the chair wrote one, and every member's answer or why it gave none. */
export function resultText(verdict: { text: string } | { why: string }, chair: string, rows: readonly Row[]): string {
  const answered = rows.filter(r => r.text !== undefined).length
  const head = 'text' in verdict
    ? `Council verdict (${answered} of ${rows.length} members answered; the chair, ${chair}, wrote it):\n\n${verdict.text}`
    : `The chair, ${chair}, wrote no verdict (${verdict.why}); ${answered} of ${rows.length} members answered.`
  return `${head}\n\nMember answers:\n\n${rows.map(rowText).join('\n\n')}`
}

/** The refusal when no member answered, naming each reason. */
export function noAnswerText(rows: readonly Row[]): string {
  return `the council got no answer: ${rows.map(r => `${r.label}: ${r.why ?? 'unknown'}`).join('; ')}`
}

/** The prompt that hands a /council run's result to the model, in the person's voice. */
export function sendText(question: string, result: string): string {
  return `I convened the council with /council. Read the verdict and the answers, check them against the code, and tell me what you take from them and what you would do next.

My question:

${question}

${result}`
}

/** The question from the tool input; a missing or empty one throws. */
export function questionOf(input: Record<string, unknown>): string {
  const question = input.question
  if (typeof question !== 'string' || question.trim() === '') throw new Error('question is required: the problem, what you tried, and what the council should answer')
  return question.trim()
}
