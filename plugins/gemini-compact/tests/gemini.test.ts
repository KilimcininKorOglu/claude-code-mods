import { describe, expect, test, tier } from 'claude-code/testing'

import { changeText, parseCommand, statusText, storedValue } from '../hooks/command.ts'
import { configFrom, DEFAULTS, outcomeText, summaryOutcomeText } from '../hooks/config.ts'
import { buildPruneBody, buildSummaryBody } from '../hooks/gemini.ts'
import { SUMMARY_TASK } from '../hooks/summary.ts'

tier('user')

type Body = { contents: { parts: { text: string }[] }[]; generationConfig: Record<string, unknown> }

describe('bodies', () => {
  test('the prune body has a schema that allows only the given ids and actions', async () => {
    const body = buildPruneBody('the transcript', ['c1', 'c2'], 'the plan') as Body & { generationConfig: { responseSchema: { properties: { decisions: { items: { properties: Record<string, { enum: string[] }> } } } } } }
    const item = body.generationConfig.responseSchema.properties.decisions.items
    expect(item.properties.id?.enum).toEqual(['c1', 'c2'])
    expect(item.properties.action?.enum).toEqual(['keep', 'truncate', 'drop'])
    expect(body.contents[0]?.parts[0]?.text).toContain('keep in mind: the plan')
    expect(body.contents[0]?.parts[0]?.text).toContain('The conversation:\n\nthe transcript')
  })

  test('the summary body asks for plain text with an output limit and no schema', async () => {
    const body = buildSummaryBody('the transcript', 32_768, 'the plan') as Body
    expect(body.generationConfig).toEqual({ maxOutputTokens: 32_768 })
    expect(body.contents[0]?.parts[0]?.text.startsWith(SUMMARY_TASK)).toBe(true)
    expect(body.contents[0]?.parts[0]?.text).toContain('keep in mind: the plan')
  })
})

describe('parseCommand', () => {
  test('reads every form', async () => {
    expect(parseCommand('')).toEqual({ kind: 'status' })
    expect(parseCommand(' status ')).toEqual({ kind: 'status' })
    expect(parseCommand('reset')).toEqual({ kind: 'reset' })
    expect(parseCommand('on')).toEqual({ kind: 'set', patch: { enabled: true } })
    expect(parseCommand('off')).toEqual({ kind: 'set', patch: { enabled: false } })
    expect(parseCommand('at 75')).toEqual({ kind: 'set', patch: { atPercent: 75 } })
    expect(parseCommand('at off')).toEqual({ kind: 'set', patch: { atPercent: 0 } })
    expect(parseCommand('mode summary')).toEqual({ kind: 'set', patch: { mode: 'summary' } })
    expect(parseCommand('mode prune')).toEqual({ kind: 'set', patch: { mode: 'prune' } })
  })

  test('refuses a bad percentage, an unknown mode, the settings gemini-core holds, and extra words', async () => {
    for (const bad of ['at', 'at 0', 'at 100', 'at 5.5', 'free', 'paid', 'model gemini-3.5-flash', 'on now', 'fast', 'at 5 6', 'mode', 'mode full', 'summary']) {
      expect(parseCommand(bad).kind, bad).toBe('error')
    }
  })

  test('says what each change does', async () => {
    expect(changeText({ atPercent: 0 })).toContain('automatic compaction off')
    expect(changeText({ atPercent: 70 })).toBe('compacts when the context passes 70%')
    expect(changeText({ enabled: false })).toBe('off: compaction uses the built-in summary')
    expect(changeText({ mode: 'summary' })).toContain('Gemini summarizes the conversation')
  })
})

describe('settings', () => {
  test('ignores a stored value of the wrong type', async () => {
    expect(storedValue('atPercent', 150)).toBe(undefined)
    expect(storedValue('enabled', false)).toBe(false)
    expect(storedValue('mode', 'full')).toBe(undefined)
    expect(storedValue('mode', 'prune')).toBe('prune')
  })

  test('replaces a missing or out-of-range option with its default', async () => {
    const c = configFrom({ compactAtPercent: 250, keepRecent: 3 })
    expect(c.atPercent).toBe(DEFAULTS.atPercent)
    expect(c.keepRecent).toBe(3)
    expect(c.mode).toBe('summary')
    expect(c.summaryMaxInputChars).toBe(2_000_000)
    expect(configFrom({ mode: 'prune' }).mode).toBe('prune')
  })

  test('the status names the state with what gemini-core holds, and the outcome lines count the actions and the messages', async () => {
    expect(summaryOutcomeText({ kept: 7, total: 58, ratio: 0.912, inputTokens: 312_400, outputTokens: 5200 })).toBe('summary: 58 → 7 messages · 91% smaller · 312k in, 5k out')
    const s = statusText({ enabled: true, mode: 'summary', atPercent: 0 }, { hasKey: false, keys: 0, tier: 'free', model: 'm' }, 'kept 1/2')
    expect(s).toBe('on · summary · m · thinking model default · automatic off · free tier · no key: set GEMINI_API_KEY or the gemini-core apiKey option\nlast: kept 1/2')
    expect(statusText({ enabled: false, mode: 'prune', atPercent: 60 }, { hasKey: true, keys: 1, tier: 'paid', model: 'm', thinking: 'low' }, undefined)).toBe('off · prune · m · thinking low · automatic at 60% · paid tier · key set')
    const line = outcomeText({ kept: 41, total: 58, ratio: 0.523, actions: ['drop', 'drop', 'truncate'], inputTokens: 31_400, outputTokens: 700 })
    expect(line).toBe('kept 41/58 messages · 52% smaller · 2 dropped, 1 truncated · 31k in, 700 out')
  })
})
