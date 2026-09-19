/** The plan review Gemini is asked for, its answer, and what the model and the user read. */
import type { EngineInterface } from 'claude-code'

/** Gemini's answer as gemini-core reads it. */
export type Answer = Extract<Awaited<ReturnType<EngineInterface['gemini']['read']>>, { answer: unknown }>['answer']

export type Severity = 'blocker' | 'minor'

export type Finding = { severity: Severity; message: string }

const SEVERITIES: readonly Severity[] = ['blocker', 'minor']

/** The plan section in which the model answers a finding it holds wrong. */
export const REBUTTAL_HEADING = '## Gemini plan review'

export const REVIEW_TASK = `You review an implementation plan a coding agent (Claude, in Claude Code) is about to show its user for approval. Below are the conversation so far, which says what the user asked for and what the agent found in the code, and the plan.

Report problems in the plan. For each, give its severity:
- blocker: a step the goal needs that the plan leaves out, an assumption the conversation or the code shown in it contradicts, a goal with no way to check that it was reached, or a decision against what the user asked for.
- minor: anything else worth saying: an unclear step, a risk, a missing test, a simpler way.
Report a blocker only with evidence in the plan or the conversation; when unsure, it is minor. An empty list is the right answer for a sound plan.
A section headed "${REBUTTAL_HEADING}" holds the agent's answers to earlier findings. Accept an answer that gives a reason the conversation supports, and do not report that finding again as a blocker.
Write each message in the language of the conversation, in one or two sentences, naming the fix.`

/** The generateContent body asking for findings on the plan, in a schema Gemini must follow. */
export function buildPlanBody(transcript: string | undefined, plan: string): Record<string, unknown> {
  const conversation = transcript === undefined ? 'The conversation is not available; only the plan is.' : `The conversation:\n\n${transcript}`
  return {
    contents: [{ role: 'user', parts: [{ text: `${REVIEW_TASK}\n\n${conversation}\n\nThe plan:\n\n${plan}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          findings: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { severity: { type: 'STRING', enum: [...SEVERITIES] }, message: { type: 'STRING' } },
              required: ['severity', 'message'],
            },
          },
        },
        required: ['findings'],
      },
    },
  }
}

/** The plan mode note names the plan file under this heading ("create your plan at /…/x.md", measured on 2.1.278). */
const PLAN_FILE = /## Plan File Info:[^/]*(\/[^\s`'"]+\.md)/

/** The plan file the engine's plan mode note names, if it names one. */
export function planFileIn(text: string): string | undefined {
  return PLAN_FILE.exec(text)?.[1]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findingOf(value: unknown): Finding {
  if (!isRecord(value)) throw new Error('a finding is not an object')
  const severity = SEVERITIES.find(s => s === value.severity)
  if (severity === undefined) throw new Error(`unknown severity ${JSON.stringify(value.severity)}`)
  if (typeof value.message !== 'string' || value.message.trim() === '') throw new Error('a finding has no message')
  return { severity, message: value.message.trim() }
}

/** Reads Gemini's findings; an answer outside the schema throws. */
export function parseFindings(answer: Answer): Finding[] {
  if (answer.finishReason === 'MAX_TOKENS') throw new Error('the review hit the output token limit')
  let value: unknown
  try {
    value = JSON.parse(answer.text)
  } catch {
    throw new Error('the review is not JSON')
  }
  if (!isRecord(value) || !Array.isArray(value.findings)) throw new Error('the review has no findings list')
  return value.findings.map(findingOf)
}

export function bullets(findings: readonly Finding[]): string {
  return findings.map(f => `- ${f.message}`).join('\n')
}

function minorBlock(minors: readonly Finding[]): string {
  return minors.length === 0 ? '' : `\n\nMinor notes, not blocking:\n${bullets(minors)}`
}

/** What the model reads when the plan is sent back; `round` counts from 1. */
export function denyText(blockers: readonly Finding[], minors: readonly Finding[], round: number, maxRounds: number): string {
  return [
    `gemini-plan-review sent this plan back before the user saw it (round ${round} of ${maxRounds}): Gemini found ${blockers.length} blocking problem(s).`,
    bullets(blockers),
    `Fix the plan and call ExitPlanMode again. If a finding is wrong, keep that part and answer it in the plan file under a "${REBUTTAL_HEADING}" heading with your reason; Gemini reads that section in the next round.${minorBlock(minors)}`,
  ].join('\n')
}

/** What the model reads after the plan passed; blockers are left only once the rounds are used up. */
export function passContext(blockers: readonly Finding[], minors: readonly Finding[], maxRounds: number): string {
  if (blockers.length > 0) {
    return `gemini-plan-review let this plan reach the user after ${maxRounds} rounds with ${blockers.length} blocking finding(s) still open:\n${bullets(blockers)}${minorBlock(minors)}\nTell the user about them.`
  }
  if (minors.length > 0) return `gemini-plan-review let this plan reach the user with ${minors.length} minor note(s):\n${bullets(minors)}\nTell the user about the ones worth acting on.`
  return 'gemini-plan-review: Gemini reviewed this plan and found nothing to report.'
}

/** What the model reads after a plan that reached the user without a review. */
export function failedContext(reason: string): string {
  return `gemini-plan-review could not review this plan and let it reach the user: ${reason}`
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** `plan reviewed · 1 blocker, 2 minor · 12k in, 1k out` */
export function summaryText(findings: readonly Finding[], answer: Answer): string {
  const blockers = findings.filter(f => f.severity === 'blocker').length
  return `plan reviewed · ${blockers} blocker, ${findings.length - blockers} minor · ${tokens(answer.inputTokens)} in, ${tokens(answer.outputTokens)} out`
}
