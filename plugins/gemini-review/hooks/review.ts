/** The review Gemini is asked for, its answer, and what the model and the user read. */
import { SKIP_VARIABLE } from './commit.ts'
import { post, type Answer, type Request } from './gemini.ts'

export type Severity = 'blocker' | 'minor'

export type Finding = { severity: Severity; file: string; line?: number; message: string }

const SEVERITIES: readonly Severity[] = ['blocker', 'minor']

export const REVIEW_TASK = `You review a git commit a coding agent (Claude, in Claude Code) is about to make for a user. Below are the conversation so far, which says what the user asked for, and the diff the commit records.

Report problems in the diff only, never in code the diff does not change. For each, give its severity:
- blocker: a bug the change introduces, data loss, a security hole, a secret or credential in the diff (an API key, a password, a private key, a token, a .env file), or a change that contradicts what the user asked for.
- minor: anything else worth saying: style, naming, a missing test, a small risk.
Report a blocker only with evidence in the diff or the conversation; when unsure, it is minor. An empty list is the right answer for a sound commit. Write each message in the language of the conversation, in one or two sentences, naming the fix.`

/** The request for findings on the diff, in a schema Gemini must follow. */
export function buildReviewRequest(model: string, apiKey: string, transcript: string | undefined, diff: string): Request {
  const conversation = transcript === undefined ? 'The conversation is not available; only the diff is.' : `The conversation:\n\n${transcript}`
  return post(model, apiKey, {
    contents: [{ role: 'user', parts: [{ text: `${REVIEW_TASK}\n\n${conversation}\n\nThe diff the commit records:\n\n${diff}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          findings: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                severity: { type: 'STRING', enum: [...SEVERITIES] },
                file: { type: 'STRING' },
                line: { type: 'INTEGER' },
                message: { type: 'STRING' },
              },
              required: ['severity', 'file', 'message'],
            },
          },
        },
        required: ['findings'],
      },
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findingOf(value: unknown): Finding {
  if (!isRecord(value)) throw new Error('a finding is not an object')
  const severity = SEVERITIES.find(s => s === value.severity)
  if (severity === undefined) throw new Error(`unknown severity ${JSON.stringify(value.severity)}`)
  if (typeof value.file !== 'string' || typeof value.message !== 'string' || value.message.trim() === '') throw new Error('a finding has no file or message')
  const line = typeof value.line === 'number' && Number.isInteger(value.line) && value.line > 0 ? value.line : undefined
  return { severity, file: value.file, message: value.message.trim(), ...(line === undefined ? {} : { line }) }
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

function where(f: Finding): string {
  return f.line === undefined ? f.file : `${f.file}:${f.line}`
}

function bullets(findings: readonly Finding[]): string {
  return findings.map(f => `- ${where(f)}: ${f.message}`).join('\n')
}

/** What the model reads when the commit is stopped. */
export function denyText(blockers: readonly Finding[], minors: readonly Finding[]): string {
  const notes = minors.length === 0 ? '' : `\n\nMinor notes, not blocking:\n${bullets(minors)}`
  return [
    `gemini-review stopped this commit: Gemini found ${blockers.length} blocking problem(s) in the change.`,
    bullets(blockers),
    `Fix them, stage the fix and run the commit again. If a finding is wrong, tell the user why, then run the same command with the prefix ${SKIP_VARIABLE}=1 (for example: ${SKIP_VARIABLE}=1 git commit ...).${notes}`,
  ].join('\n')
}

/** What the model reads after a commit that passed with minor notes. */
export function minorContext(minors: readonly Finding[]): string {
  return `gemini-review let this commit run with ${minors.length} minor note(s):\n${bullets(minors)}\nThey did not stop the commit; tell the user about the ones worth fixing.`
}

/** What the model reads after a commit Gemini found nothing in, so it knows the review ran. */
export function cleanContext(files: number): string {
  return `gemini-review: Gemini reviewed the ${files} file(s) of this commit and found nothing to report.`
}

/** What the model reads after a commit that ran without a review. */
export function failedContext(reason: string): string {
  return `gemini-review could not review this commit and let it run: ${reason}`
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** `reviewed 3 files · 1 blocker, 2 minor · 12k in, 1k out` */
export function summaryText(files: number, findings: readonly Finding[], answer: Answer): string {
  const blockers = findings.filter(f => f.severity === 'blocker').length
  return `reviewed ${files} file(s) · ${blockers} blocker, ${findings.length - blockers} minor · ${tokens(answer.inputTokens)} in, ${tokens(answer.outputTokens)} out`
}
