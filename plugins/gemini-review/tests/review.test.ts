import { describe, expect, test, tier } from 'claude-code/testing'

import { changeText, FREE_WARNING, parseCommand } from '../hooks/command.ts'
import { configFrom } from '../hooks/config.ts'
import { retryDelay } from '../hooks/gemini.ts'
import { buildReviewRequest, denyText, failedContext, minorContext, parseFindings, REVIEW_TASK, summaryText } from '../hooks/review.ts'

tier('user')

const answer = (text: string, finishReason = 'STOP') => ({ text, inputTokens: 12_400, outputTokens: 900, finishReason })

describe('buildReviewRequest', () => {
  test('posts the task, the conversation and the diff with the key in a header and a findings schema', async () => {
    const r = buildReviewRequest('gemini-3.8-flash', 'KEY', 'the talk', 'the diff')
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(r.url).not.toContain('KEY')
    expect(r.init.headers['x-goog-api-key']).toBe('KEY')
    const body = JSON.parse(r.init.body)
    expect(body.contents[0].parts[0].text).toBe(`${REVIEW_TASK}\n\nThe conversation:\n\nthe talk\n\nThe diff the commit records:\n\nthe diff`)
    expect(body.generationConfig.responseSchema.properties.findings.items.properties.severity.enum).toEqual(['blocker', 'minor'])
  })
})

describe('parseFindings', () => {
  test('reads the findings, with a line when it is a positive whole number', async () => {
    const text = JSON.stringify({ findings: [{ severity: 'blocker', file: 'a.ts', line: 4, message: ' Key in code. ' }, { severity: 'minor', file: 'b.ts', line: 0, message: 'Name it.' }] })
    expect(parseFindings(answer(text))).toEqual([
      { severity: 'blocker', file: 'a.ts', line: 4, message: 'Key in code.' },
      { severity: 'minor', file: 'b.ts', message: 'Name it.' },
    ])
    expect(parseFindings(answer('{"findings":[]}'))).toEqual([])
  })

  test('refuses an answer outside the schema or cut at the output limit', async () => {
    expect(() => parseFindings(answer('ok'))).toThrow('not JSON')
    expect(() => parseFindings(answer('{"notes":[]}'))).toThrow('no findings list')
    expect(() => parseFindings(answer('{"findings":[{"severity":"major","file":"a","message":"m"}]}'))).toThrow('unknown severity')
    expect(() => parseFindings(answer('{"findings":[{"severity":"minor","file":"a","message":" "}]}'))).toThrow('no file or message')
    expect(() => parseFindings(answer('{"findings":[]}', 'MAX_TOKENS'))).toThrow('output token limit')
  })
})

describe('texts', () => {
  const blocker = { severity: 'blocker' as const, file: 'a.ts', line: 4, message: 'An API key is in the code.' }
  const minor = { severity: 'minor' as const, file: 'b.ts', message: 'Name the constant.' }

  test('the denial names each blocker, the minor notes and the skip prefix', async () => {
    const text = denyText([blocker], [minor])
    expect(text).toContain('Gemini found 1 blocking problem(s)')
    expect(text).toContain('- a.ts:4: An API key is in the code.')
    expect(text).toContain('GEMINI_REVIEW_SKIP=1 git commit ...')
    expect(text).toContain('Minor notes, not blocking:\n- b.ts: Name the constant.')
  })

  test('the notes after a commit that ran', async () => {
    expect(minorContext([minor])).toContain('let this commit run with 1 minor note(s):\n- b.ts: Name the constant.')
    expect(failedContext('Gemini HTTP 429')).toBe('gemini-review could not review this commit and let it run: Gemini HTTP 429')
    expect(summaryText(3, [blocker, minor], answer(''))).toBe('reviewed 3 file(s) · 1 blocker, 1 minor · 12k in, 900 out')
  })
})

describe('settings', () => {
  test('reads the command, the options and the retry rule', async () => {
    expect(parseCommand('off')).toEqual({ kind: 'set', patch: { enabled: false } })
    expect(parseCommand('model x/y').kind).toBe('error')
    expect(changeText({ tier: 'free' })).toBe(FREE_WARNING)
    expect(configFrom({}).model).toBe('gemini-3.8-flash')
    expect([1, 2, 3, 4].map(n => retryDelay(503, n, 0))).toEqual([1000, 2000, 3000, undefined])
    expect(retryDelay(503, 1, 59_500)).toBe(undefined)
    expect(retryDelay(500, 1, 0)).toBe(undefined)
  })
})
