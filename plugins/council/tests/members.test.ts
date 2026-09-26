import { describe, expect, test, tier } from 'claude-code/testing'

import { isSessionModel, memberOf, parseMembers, storedMembers } from '../hooks/members.ts'

tier('user')

describe('members', () => {
  test('a short name, a claude- id and a Gemini id each name a member; anything else names none', () => {
    expect(memberOf('opus')).toEqual({ kind: 'claude', id: 'claude-opus-5-5', label: 'opus 5.5' })
    expect(memberOf('claude-haiku-4-5-20251001')).toEqual({ kind: 'claude', id: 'claude-haiku-4-5-20251001', label: 'haiku 4.5' })
    expect(memberOf('gemini-3.1-pro-preview')).toEqual({ kind: 'gemini', id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' })
    expect(memberOf('gemma-4-31b-it')?.kind).toBe('gemini')
    expect(memberOf('sonet')).toBe(undefined)
    expect(memberOf('constructor')).toBe(undefined)
    expect(memberOf('gemini-../x')).toBe(undefined)
  })

  test('a typo is refused by name, and a repeat is kept once', () => {
    expect(parseMembers(['opus', 'sonet'])).toEqual({ error: 'sonet is not a model: use opus, sonnet, fable, haiku, a claude- model id, or a gemini- or gemma- model id' })
    expect(parseMembers([])).toMatchObject({ error: expect.stringContaining('members takes one or more models') })
    expect(parseMembers(['opus', 'gemini-3.8-flash', 'opus'])).toEqual({ members: ['opus', 'gemini-3.8-flash'] })
  })

  test('the store gives the members, or the defaults when it holds none that name a model', () => {
    expect(storedMembers(['sonnet', 42, 'nope']).map(m => m.label)).toEqual(['sonnet 5'])
    expect(storedMembers(undefined).map(m => m.label)).toEqual(['opus 5.5', 'sonnet 5', 'fable 5.1', 'haiku 4.5', 'gemini-3.8-flash'])
  })

  test('the member on the model of the session is found with the window mark and with a dated id', () => {
    const opus = memberOf('opus')
    const haiku = memberOf('haiku')
    if (opus === undefined || haiku === undefined) throw new Error('no member')
    expect(isSessionModel(opus, 'claude-opus-5-5[1m]')).toBe(true)
    expect(isSessionModel(haiku, 'claude-haiku-4-5')).toBe(true)
    expect(isSessionModel(opus, 'claude-opus-5')).toBe(false)
    expect(isSessionModel(opus, undefined)).toBe(false)
  })
})
