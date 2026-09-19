import { describe, expect, test, tier } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { parseSummary, SUMMARY_NOTE, summaryMessage, tailStart } from '../hooks/summary.ts'

tier('user')

const m = (role: 'user' | 'assistant', text = ''): SessionMessage => ({ role, text, toolUses: [] })

// prompt, call, result, call, result, answer, prompt
const CONVERSATION: SessionMessage[] = [m('user', 'go'), m('assistant'), m('user'), m('assistant'), m('user'), m('assistant', 'done'), m('user', 'next')]

describe('tailStart', () => {
  test('starts the tail at the newest messages when the first of them is an assistant message', async () => {
    expect(tailStart(CONVERSATION, 4)).toBe(3)
  })

  test('moves back to an assistant message, so no tool result is kept without its call', async () => {
    expect(tailStart(CONVERSATION, 3)).toBe(3)
    expect(tailStart(CONVERSATION, 1)).toBe(5)
  })

  test('summarizes everything when no assistant message follows the first message, or nothing is kept', async () => {
    expect(tailStart([m('user', 'a'), m('user', 'b')], 1)).toBe(2)
    expect(tailStart(CONVERSATION, 0)).toBe(7)
  })

  test('never keeps the whole conversation', async () => {
    expect(tailStart(CONVERSATION, 50)).toBe(1)
  })
})

describe('parseSummary', () => {
  const long = 'x'.repeat(250)

  test('takes a summary of enough length, trimmed', async () => {
    expect(parseSummary(`  ${long}\n`, 'STOP')).toBe(long)
  })

  test('refuses a summary cut at the output limit, and one too short', async () => {
    expect(() => parseSummary(long, 'MAX_TOKENS')).toThrow('output token limit')
    expect(() => parseSummary('  ok  ')).toThrow('too short (2 chars)')
  })

  test('the summary becomes a user message without a handle, after the note', async () => {
    expect(summaryMessage('S')).toEqual({ role: 'user', text: `${SUMMARY_NOTE}\n\nS`, toolUses: [] })
  })
})
