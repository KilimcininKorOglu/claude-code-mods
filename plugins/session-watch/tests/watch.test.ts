import { describe, expect, test, tier } from 'claude-code/testing'

import {
  addSplit, cacheHit, cacheHitTone, contextTone, effortTone, endFile, failedGit, fmtTok, gitLine, modelTone, NO_SPLIT, parseStatus, scanUsage, sidebarLines, statusText, storedSplits, transcriptDir, usageScannerOf, usageTotal, withSplit,
  type Reading,
} from '../hooks/watch.ts'

tier('user')

// Captured from git 2.51 in a scratch repository: `a` added and then changed again, `b` new.
const DIRTY = '# branch.oid cab7e3abdaf86aa8883f5fcd0c2f885039ea8ebc\n# branch.head main\n1 AM N... 000000 100644 100644 0000000000000000000000000000000000000000 78981922613b2afb6025042ff6bd878ac1994e85 a\n? b\n'
const DETACHED = '# branch.oid cab7e3abdaf86aa8883f5fcd0c2f885039ea8ebc\n# branch.head (detached)\n'
// Captured in this repository: a branch with an upstream and nothing changed.
const CLEAN = '# branch.oid fe4b552c3f34ec65700b7e65fa605c89f136e825\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n'

const reading = (over: Partial<Reading> = {}): Reading => ({
  context: { tokens: 245_000, window: 1_000_000, percent: 25 },
  costUsd: 1.234,
  split: { input: 3000, output: 45_000, cacheRead: 1_100_000, cacheWrite: 80_000 },
  seeding: false,
  model: 'claude-opus-5-5',
  effort: 'high',
  version: '2.1.282',
  git: parseStatus(CLEAN),
  ...over,
})

describe('git status', () => {
  test('counts the staged, changed and new files, and reads the branch and its upstream', () => {
    expect(parseStatus(DIRTY)).toEqual({ kind: 'repo', head: 'main', staged: 1, modified: 1, untracked: 1, conflicted: 0 })
    expect(parseStatus(CLEAN)).toEqual({ kind: 'repo', head: 'main', ab: { ahead: 2, behind: 1 }, staged: 0, modified: 0, untracked: 0, conflicted: 0 })
    expect(parseStatus(DETACHED).head).toBe('detached at cab7e3a')
    expect(parseStatus('# branch.head x\nu UU N... 100644 100644 100644 100644 a b c f\n').conflicted).toBe(1)
  })

  test('a changed tree reads yellow, a clean one green, and a directory outside git says so', () => {
    expect(gitLine(parseStatus(DIRTY))).toEqual({ text: 'main · 1 staged, 1 modified, 1 untracked · no upstream', kind: 'warn' })
    expect(gitLine(parseStatus(CLEAN))).toEqual({ text: 'main · clean · ↑2 ↓1', kind: 'ok' })
    expect(failedGit('fatal: not a git repository (or any of the parent directories): .git\n')).toEqual({ kind: 'none' })
    expect(gitLine(failedGit('fatal: not a git repository (or any of the parent directories): .git\n'))).toEqual({ text: 'git: this folder is not a git repository', kind: 'dim' })
    expect(gitLine(failedGit('\nfatal: detected dubious ownership\n'))).toEqual({ text: 'git: fatal: detected dubious ownership', kind: 'dim' })
  })
})

describe('reading', () => {
  test('the context is green under 50%, yellow up to 80%, red above', () => {
    expect([49, 50, 80, 81].map(contextTone)).toEqual(['ok', 'warn', 'warn', 'error'])
  })

  test('the section reads context, tokens, cost, model with thinking, version and git, in that order', () => {
    expect(sidebarLines(reading())).toEqual([
      { text: 'ctx 25% · 245k / 1.0M', kind: 'ok' },
      { text: 'tokens T 1.2M · I 3k · O 45k · CR 1.1M · CW 80k · CH 92%', parts: [{ text: 'tokens T 1.2M · I 3k · O 45k · CR 1.1M · CW 80k' }, { text: ' · CH ' }, { text: '92%', kind: 'ok' }] },
      { text: 'cost $1.23' },
      {
        text: 'model opus-5-5 · thinking high',
        parts: [{ text: 'model ' }, { text: 'opus-5-5', kind: 'error' }, { text: ' · ' }, { text: 'thinking ' }, { text: 'high', kind: 'warn' }],
      },
      { text: 'Claude Code 2.1.282' },
      { text: 'main · clean · ↑2 ↓1', kind: 'ok' },
    ])
  })

  test('the model is coloured by family, the dearest the warmest, and a model of no known family has no colour', () => {
    expect(['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'gpt-x'].map(modelTone)).toEqual(['error', 'warn', 'ok', 'dim', undefined])
  })

  test('the thinking level is coloured by how hard it asks, and only the level itself', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max', 'turbo', 12_000, null, undefined].map(effortTone)).toEqual(['dim', 'ok', 'warn', 'error', 'error', undefined, undefined, undefined, undefined])
    expect(sidebarLines(reading({ effort: 'low' }))[3]?.parts?.at(-1)).toEqual({ text: 'low', kind: 'dim' })
    expect(sidebarLines(reading({ effort: null }))[3]?.parts?.at(-1)).toEqual({ text: 'no thinking setting', kind: 'dim' })
  })

  test('while the transcripts are read, the tokens line says so instead of a partial count', () => {
    expect(sidebarLines(reading({ seeding: true }))[1]).toEqual({ text: 'tokens: reading the transcripts', kind: 'dim' })
  })

  test('what is not known yet is said, not zeroed', () => {
    const lines = sidebarLines(reading({ context: { window: 200_000 }, costUsd: undefined, effort: undefined, git: undefined }))
    expect(lines.map(l => l.text)).toEqual(['ctx: no reply yet', 'tokens T 1.2M · I 3k · O 45k · CR 1.1M · CW 80k · CH 92%', 'cost: no ledger in this host', 'model opus-5-5 · thinking: not read yet', 'Claude Code 2.1.282', 'git: not read yet'])
    expect(sidebarLines(reading({ effort: null }))[3]?.text).toBe('model opus-5-5 · no thinking setting')
    expect(sidebarLines(reading({ seeding: true }))[1]?.text).toBe('tokens: reading the transcripts')
    expect(sidebarLines(reading({ effort: 12_000 }))[3]?.text).toBe('model opus-5-5 · thinking budget 12000')
  })

  test('the status line is short, and marks a changed tree with a star', () => {
    expect(statusText(reading())).toBe('ctx 25% · $1.23 · main')
    expect(statusText(reading({ git: parseStatus(DIRTY), costUsd: undefined }))).toBe('ctx 25% · main*')
  })
})

describe('token totals', () => {
  test('the cache hit is the share of the input read from the cache, rounded down, and absent before any input', () => {
    expect(cacheHit({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBe(undefined)
    expect(cacheHit({ input: 1, output: 0, cacheRead: 999, cacheWrite: 0 })).toBe(99)
    expect(cacheHit({ input: 0, output: 0, cacheRead: 3_300_000_000, cacheWrite: 27_500_000 })).toBe(99)
    expect(cacheHit({ input: 0, output: 0, cacheRead: 0, cacheWrite: 100 })).toBe(0)
    expect([100, 90, 89, 70, 69, 0].map(cacheHitTone)).toEqual(['ok', 'ok', 'warn', 'warn', 'error', 'error'])
  })

  test('each turn adds its tokens by kind', () => {
    const one = addSplit(NO_SPLIT, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })
    expect(addSplit(one, { output_tokens: 5 })).toEqual({ input: 10, output: 10, cacheRead: 100, cacheWrite: 20 })
    expect(addSplit(one, undefined)).toBe(one)
    expect([830, 245_400, 1_234_567, 3_240_000_000].map(fmtTok)).toEqual(['830', '245k', '1.2M', '3.2B'])
    // A count of another type from a transcript adds nothing.
    expect(addSplit(NO_SPLIT, { input_tokens: '5' as unknown as number, output_tokens: -1 })).toEqual(NO_SPLIT)
  })

  test('the transcripts lie under a directory named after the start directory', () => {
    expect(transcriptDir('/Users/k/.claude', '/Users/k/my app.v2')).toBe('/Users/k/.claude/projects/-Users-k-my-app-v2')
  })

  test('a transcript read in pieces counts each response once, its last row, and a line cut between files alone', () => {
    const row = (id: string, output: number) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 1, output_tokens: output } } })
    const s = usageScannerOf()
    const text = `${row('a', 5)}\n${row('a', 9)}\n{"type":"user","message":{"usage":"assistant"}}\nnot json "usage" "assistant"\n${row('b', 1)}`
    scanUsage(s, text.slice(0, 30))
    scanUsage(s, text.slice(30))
    endFile(s)
    // The second file starts with a row of its own, not the first file's unfinished line.
    scanUsage(s, `${row('c', 100)}\n`)
    expect(usageTotal(s)).toEqual({ input: 3, output: 110, cacheRead: 0, cacheWrite: 0 })
  })

  test('the store keeps the last 20 sessions, this one last, and drops a value of another shape', () => {
    const stored = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${i}`, NO_SPLIT]))
    const kept = withSplit(storedSplits({ ...stored, bad: { input: 'x' } }), 's0', { ...NO_SPLIT, input: 1 })
    expect(Object.keys(kept)).toHaveLength(20)
    expect(Object.keys(kept).at(-1)).toBe('s0')
    expect(kept.s0?.input).toBe(1)
    expect(storedSplits('nope')).toEqual({})
  })
})
