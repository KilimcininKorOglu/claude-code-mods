/**
 * The pure part of the summary mode: where the verbatim tail starts, what
 * Gemini is asked, and the message its summary becomes.
 */
import type { SessionMessage } from 'claude-code'

/**
 * The index where the newest `keepRecent` messages start, moved back to an
 * assistant message: the tail then holds every tool result whose call it
 * holds, and it follows the summary (a user message) with an assistant one.
 * With no assistant message after the first, everything is summarized.
 */
export function tailStart(messages: readonly SessionMessage[], keepRecent: number): number {
  if (keepRecent <= 0) return messages.length
  for (let i = Math.max(1, messages.length - keepRecent); i >= 1; i--) {
    if (messages[i]?.role === 'assistant') return i
  }
  return messages.length
}

export const SUMMARY_TASK = `You write the summary that replaces the older part of a Claude Code conversation, because its context is being compacted. The assistant continues the work from your summary and the newest messages, which stay verbatim after it. It cannot see anything you leave out.

Write plain text with these sections:
1. Primary request and intent: everything the user asked for, in detail.
2. Key technical concepts: technologies, frameworks and facts the work relies on.
3. Files and code: every file read, created or changed, with its full path, why it matters, and the code snippets the work still needs.
4. Errors and fixes: each error met, how it was fixed, and what the user said about it.
5. Problem solving: problems solved and open investigations.
6. All user messages: every user message that is not a tool result, verbatim.
7. Pending tasks: what the user asked for that is not done.
8. Current work: what was being done right before this summary, with file names and code.
9. Next step: the step that follows from the latest request, quoting the user's words.

Keep exact names, paths, commands, numbers and error texts. Do not invent anything the conversation does not say.`

/** The note in front of the summary, so the assistant knows what it reads. */
export const SUMMARY_NOTE =
  'This session continues an earlier conversation that was compacted. Gemini wrote the summary below of the part before the newest messages, which follow it verbatim.'

/** The first message of the compacted conversation; without a handle, the engine builds it from its role and text. */
export function summaryMessage(summary: string): SessionMessage {
  return { role: 'user', text: `${SUMMARY_NOTE}\n\n${summary}`, toolUses: [] }
}

const MIN_SUMMARY_CHARS = 200

/** The summary text; one Gemini cut at its output limit, an empty one or a too short one throws. */
export function parseSummary(text: string, finishReason?: string): string {
  if (finishReason === 'MAX_TOKENS') throw new Error('the summary hit the output token limit')
  const summary = text.trim()
  if (summary.length < MIN_SUMMARY_CHARS) throw new Error(`the summary is too short (${summary.length} chars)`)
  return summary
}
