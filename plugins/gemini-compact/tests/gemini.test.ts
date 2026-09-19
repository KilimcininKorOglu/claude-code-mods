import { describe, expect, test, tier } from 'claude-code/testing'

import { changeText, FREE_WARNING, parseCommand, statusText, storedValue } from '../hooks/command.ts'
import { configFrom, DEFAULTS, outcomeText, summaryOutcomeText } from '../hooks/config.ts'
import { buildRequest, buildSummaryRequest, parseResponse } from '../hooks/gemini.ts'
import { SUMMARY_TASK } from '../hooks/summary.ts'

tier('user')

describe('buildRequest', () => {
  test('posts to the model with the key in a header and a schema that allows only the given ids and actions', async () => {
    const r = buildRequest('gemini-3.5-flash-lite', 'KEY', 'the transcript', ['c1', 'c2'], 'the plan')
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(r.url).not.toContain('KEY')
    expect(r.init.headers['x-goog-api-key']).toBe('KEY')
    const body = JSON.parse(r.init.body)
    const item = body.generationConfig.responseSchema.properties.decisions.items
    expect(item.properties.id.enum).toEqual(['c1', 'c2'])
    expect(item.properties.action.enum).toEqual(['keep', 'truncate', 'drop'])
    expect(body.contents[0].parts[0].text).toContain('keep in mind: the plan')
    expect(body.contents[0].parts[0].text).toContain('The conversation:\n\nthe transcript')
  })

  test('the summary request asks for plain text with an output limit and no schema', async () => {
    const r = buildSummaryRequest('gemini-3.5-flash-lite', 'KEY', 'the transcript', 32_768, 'the plan')
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(r.init.headers['x-goog-api-key']).toBe('KEY')
    const body = JSON.parse(r.init.body)
    expect(body.generationConfig).toEqual({ maxOutputTokens: 32_768 })
    expect(body.contents[0].parts[0].text.startsWith(SUMMARY_TASK)).toBe(true)
    expect(body.contents[0].parts[0].text).toContain('keep in mind: the plan')
  })
})

describe('parseResponse', () => {
  const ok = (parts: unknown[], usage = { promptTokenCount: 31_000, candidatesTokenCount: 400, thoughtsTokenCount: 600 }) =>
    JSON.stringify({ candidates: [{ content: { parts } }], usageMetadata: usage })

  test('reads the answer text past a thought part, with the token counts', async () => {
    const a = parseResponse(200, true, ok([{ text: 'thinking', thought: true }, { text: '{"decisions":[]}' }]))
    expect(a).toEqual({ text: '{"decisions":[]}', inputTokens: 31_000, outputTokens: 1000 })
  })

  test('reads the finish reason', async () => {
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'cut' }] }, finishReason: 'MAX_TOKENS' }] })
    expect(parseResponse(200, true, body).finishReason).toBe('MAX_TOKENS')
  })

  test('turns an HTTP error, a blocked answer and a body that is not JSON into errors', async () => {
    const quota = JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted' } })
    expect(() => parseResponse(429, false, quota)).toThrow('Gemini HTTP 429: Resource has been exhausted')
    expect(() => parseResponse(502, false, '<html>')).toThrow('Gemini HTTP 502')
    expect(() => parseResponse(200, true, JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } }))).toThrow('Gemini gave no answer')
    expect(() => parseResponse(200, true, 'nope')).toThrow('no JSON')
  })
})

describe('parseCommand', () => {
  test('reads every form', async () => {
    expect(parseCommand('')).toEqual({ kind: 'status' })
    expect(parseCommand(' status ')).toEqual({ kind: 'status' })
    expect(parseCommand('reset')).toEqual({ kind: 'reset' })
    expect(parseCommand('on')).toEqual({ kind: 'set', patch: { enabled: true } })
    expect(parseCommand('off')).toEqual({ kind: 'set', patch: { enabled: false } })
    expect(parseCommand('free')).toEqual({ kind: 'set', patch: { tier: 'free' } })
    expect(parseCommand('paid')).toEqual({ kind: 'set', patch: { tier: 'paid' } })
    expect(parseCommand('model gemini-3.5-flash')).toEqual({ kind: 'set', patch: { model: 'gemini-3.5-flash' } })
    expect(parseCommand('at 75')).toEqual({ kind: 'set', patch: { atPercent: 75 } })
    expect(parseCommand('at off')).toEqual({ kind: 'set', patch: { atPercent: 0 } })
    expect(parseCommand('mode summary')).toEqual({ kind: 'set', patch: { mode: 'summary' } })
    expect(parseCommand('mode prune')).toEqual({ kind: 'set', patch: { mode: 'prune' } })
  })

  test('refuses a bad percentage, a model id that could leave the URL path, an unknown mode, and extra words', async () => {
    for (const bad of ['at', 'at 0', 'at 100', 'at 5.5', 'model', 'model ../x', 'model a/b', 'model Gemini', 'on now', 'fast', 'at 5 6', 'mode', 'mode full', 'summary']) {
      expect(parseCommand(bad).kind, bad).toBe('error')
    }
  })

  test('says what each change does, the free tier with its warning', async () => {
    expect(changeText({ tier: 'free' })).toBe(FREE_WARNING)
    expect(changeText({ atPercent: 0 })).toContain('automatic compaction off')
    expect(changeText({ atPercent: 70 })).toBe('compacts when the context passes 70%')
    expect(changeText({ enabled: false })).toBe('off: compaction uses the built-in summary')
    expect(changeText({ mode: 'summary' })).toContain('Gemini summarizes the conversation')
  })
})

describe('settings', () => {
  test('ignores a stored value of the wrong type', async () => {
    expect(storedValue('tier', 'cheap')).toBe(undefined)
    expect(storedValue('atPercent', 150)).toBe(undefined)
    expect(storedValue('model', 'x/y')).toBe(undefined)
    expect(storedValue('enabled', false)).toBe(false)
    expect(storedValue('mode', 'full')).toBe(undefined)
    expect(storedValue('mode', 'prune')).toBe('prune')
  })

  test('replaces a missing or out-of-range option with its default', async () => {
    const c = configFrom({ compactAtPercent: 250, keepRecent: 3, tier: 'paid', apiKey: '  ' })
    expect(c.atPercent).toBe(DEFAULTS.atPercent)
    expect(c.keepRecent).toBe(3)
    expect(c.tier).toBe('paid')
    expect(c.apiKey).toBe(undefined)
    expect(c.model).toBe('gemini-3.5-flash-lite')
    expect(c.mode).toBe('summary')
    expect(c.summaryMaxInputChars).toBe(2_000_000)
    expect(configFrom({ mode: 'prune' }).mode).toBe('prune')
  })

  test('the status names the state, and the outcome lines count the actions and the messages', async () => {
    expect(summaryOutcomeText({ kept: 7, total: 58, ratio: 0.912, inputTokens: 312_400, outputTokens: 5200 })).toBe('summary: 58 → 7 messages · 91% smaller · 312k in, 5k out')
    const s = statusText({ enabled: true, mode: 'summary', tier: 'free', model: 'm', atPercent: 0 }, false, 'kept 1/2')
    expect(s).toBe('on · summary · m · automatic off · free tier · no key: set GEMINI_API_KEY or the plugin option\nlast: kept 1/2')
    const line = outcomeText({ kept: 41, total: 58, ratio: 0.523, actions: ['drop', 'drop', 'truncate'], inputTokens: 31_400, outputTokens: 700 })
    expect(line).toBe('kept 41/58 messages · 52% smaller · 2 dropped, 1 truncated · 31k in, 700 out')
  })
})
