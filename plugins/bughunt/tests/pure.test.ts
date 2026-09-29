import { describe, expect, test, tier } from 'claude-code/testing'

import { parseArgs } from '../hooks/args.ts'
import { criticTask, findingOf, reportText, verdictOf } from '../hooks/collab.ts'
import { editRule, inScope, isTestPath, relativeTo } from '../hooks/paths.ts'
import { judgeProof, proofInput } from '../hooks/proof.ts'
import { advance, decide, fingerprintOf, newHunt, outcomeOf, type Hunt } from '../hooks/round.ts'
import { roundText } from '../hooks/texts.ts'

tier('user')

const run = (exitCode: number, stdout: string) => ({ exitCode, stdout, stderr: '' })
const answered = (answer: string) => ({ reason: 'answer', isAborted: false, answer })

describe('parseArgs', () => {
  test('reads --rounds before or after the target', async () => {
    expect(parseArgs('--rounds 3 packages/x')).toEqual({ kind: 'start', rounds: 3, target: 'packages/x' })
    expect(parseArgs('packages/x --rounds 3')).toEqual({ kind: 'start', rounds: 3, target: 'packages/x' })
    expect(parseArgs('packages/x --rounds=2')).toEqual({ kind: 'start', rounds: 2, target: 'packages/x' })
  })

  test('runs one round over the whole project by default', async () => {
    expect(parseArgs('')).toEqual({ kind: 'start', rounds: 1, target: '' })
  })

  test('refuses a round count outside 1..25 or not whole', async () => {
    for (const v of ['0', '26', '2.5', 'x', '']) expect(parseArgs(`--rounds ${v}`).kind).toBe('error')
  })

  test('reads the control words and collab', async () => {
    expect(parseArgs('stop')).toEqual({ kind: 'stop' })
    expect(parseArgs('collab src lib')).toEqual({ kind: 'collab', paths: ['src', 'lib'] })
    expect(parseArgs('collab').kind).toBe('error')
    expect(parseArgs('stop now')).toEqual({ kind: 'start', rounds: 1, target: 'stop now' })
  })
})

describe('outcomeOf and fingerprintOf', () => {
  test('reads the label on the first line, markdown stripped', async () => {
    expect(outcomeOf('**fixed-and-verified**\n\nroot cause')).toBe('fixed-and-verified')
    expect(outcomeOf('\n`blocked`: no toolchain')).toBe('blocked')
    expect(outcomeOf('# no-proven-bug')).toBe('no-proven-bug')
  })

  test('does not read a label that is only mentioned later or is a longer word', async () => {
    expect(outcomeOf('I looked around.\nblocked')).toBeUndefined()
    expect(outcomeOf('fixed-and-verified-ish')).toBeUndefined()
  })

  test('reads the fingerprint line', async () => {
    expect(fingerprintOf('x\n- **fingerprint:** `src/a.ts:parse: off by one`\n')).toBe('src/a.ts:parse: off by one')
    expect(fingerprintOf('no line')).toBeUndefined()
  })
})

describe('decide', () => {
  const proven: Hunt = { ...newHunt('h', 2, ''), proof: { argv: ['t'], failed: true, passed: true } }

  test('continues after a proven fix and ends at the last round', async () => {
    expect(decide(proven, answered('fixed-and-verified'))).toEqual({ next: 'continue' })
    expect(decide({ ...proven, round: 2 }, answered('fixed-and-verified'))).toEqual({ next: 'done' })
    expect(decide(newHunt('h', 2, ''), answered('no-proven-bug'))).toEqual({ next: 'continue' })
  })

  test('stops on blocked, incomplete, a missing label, an error or an interrupt', async () => {
    for (const a of ['blocked', 'fixed-verification-incomplete', 'Done.']) expect(decide(proven, answered(a)).next).toBe('stop')
    expect(decide(proven, { reason: 'error', isAborted: false, answer: '' }).next).toBe('stop')
    expect(decide(proven, { reason: 'aborted', isAborted: true, answer: 'fixed-and-verified' }).next).toBe('stop')
  })

  test('stops a fixed-and-verified claim the proof tool did not record', async () => {
    const half: Hunt = { ...proven, proof: { argv: ['t'], failed: true, passed: false } }
    expect(decide(half, answered('fixed-and-verified')).next).toBe('stop')
    expect(decide(newHunt('h', 2, ''), answered('fixed-and-verified')).next).toBe('stop')
  })

  test('advance records the round and clears the round state', async () => {
    const next = advance({ ...proven, skill: true }, 'fixed-and-verified\nfingerprint: a.ts:f: x')
    expect(next).toMatchObject({ round: 2, skill: false, proof: undefined, history: [{ round: 1, outcome: 'fixed-and-verified', fingerprint: 'a.ts:f: x' }] })
    expect(roundText(next, 'd')).toContain('- a.ts:f: x')
  })
})

describe('proof', () => {
  test('before needs a non-zero exit and a FAIL line', async () => {
    expect(judgeProof('before', ['t'], run(1, 'FAIL: got 3'), undefined)).toMatchObject({ accepted: true, state: { failed: true } })
    expect(judgeProof('before', ['t'], run(0, 'FAIL'), undefined).accepted).toBe(false)
    expect(judgeProof('before', ['t'], run(1, 'Error: cannot import'), undefined).accepted).toBe(false)
  })

  test('after needs the recorded FAIL, the same argv, exit 0 and a PASS line', async () => {
    const failed = { argv: ['t'], failed: true, passed: false }
    expect(judgeProof('after', ['t'], run(0, 'PASS'), failed)).toMatchObject({ accepted: true, state: { passed: true } })
    expect(judgeProof('after', ['t'], run(0, 'PASS'), undefined).accepted).toBe(false)
    expect(judgeProof('after', ['u'], run(0, 'PASS'), failed).accepted).toBe(false)
    expect(judgeProof('after', ['t'], run(1, 'PASS'), failed).accepted).toBe(false)
    expect(judgeProof('after', ['t'], run(0, 'ok'), failed).accepted).toBe(false)
  })

  test('proofInput refuses a bad phase or argv', async () => {
    expect(proofInput({ phase: 'before', argv: ['node', 'p.js'] })).toEqual({ phase: 'before', argv: ['node', 'p.js'], cwd: undefined })
    expect(typeof proofInput({ phase: 'during', argv: ['x'] })).toBe('string')
    expect(typeof proofInput({ phase: 'after', argv: [] })).toBe('string')
  })
})

describe('paths', () => {
  const gate = { skill: true, failed: true, target: 'src/core', dir: '.temp_files/bughunt/r1' }

  test('relativeTo strips the working directory', async () => {
    expect(relativeTo('/w/', '/w/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/w', '/other/a.ts')).toBe('/other/a.ts')
  })

  test('scope matches whole path segments', async () => {
    expect(inScope('src/core/a.ts', 'src/core')).toBe(true)
    expect(inScope('src/corex/a.ts', 'src/core')).toBe(false)
    expect(inScope('anything', '')).toBe(true)
  })

  test('recognises test files', async () => {
    for (const p of ['tests/a.ts', 'src/a.test.ts', 'pkg/a_test.go', 'x/test_a.py', 'a/__tests__/b.js']) expect(isTestPath(p)).toBe(true)
    expect(isTestPath('src/testing.ts')).toBe(false)
  })

  test('editRule: skill first, proof dir free, then proof, then scope with tests exempt', async () => {
    expect(editRule('src/core/a.ts', { ...gate, skill: false })).toBe('skill')
    expect(editRule('.temp_files/bughunt/r1/p.js', { ...gate, failed: false })).toBeUndefined()
    expect(editRule('src/core/a.ts', { ...gate, failed: false })).toBe('proof')
    expect(editRule('src/other/a.ts', gate)).toBe('scope')
    expect(editRule('tests/a.test.ts', gate)).toBeUndefined()
    expect(editRule('src/core/a.ts', gate)).toBeUndefined()
  })
})

describe('collab', () => {
  test('findingOf validates each field', async () => {
    expect(findingOf({ file: 'a.ts', line: 3, severity: 'high', description: 'x' })).toEqual({ file: 'a.ts', line: 3, severity: 'high', description: 'x' })
    expect(typeof findingOf({ file: 'a.ts', line: 0, severity: 'high', description: 'x' })).toBe('string')
    expect(typeof findingOf({ file: 'a.ts', line: 3, severity: 'huge', description: 'x' })).toBe('string')
  })

  test('verdictOf reads the verdict line and never defaults to approve', async () => {
    expect(verdictOf('**verdict:** revise\nreasons')).toBe('revise')
    expect(verdictOf('Looks good to me.')).toBe('no-verdict')
    expect(reportText(['a'], [], [], 'no-verdict')).toContain('this is not an approval')
  })

  test('the critic task carries the findings and the plan', async () => {
    const text = criticTask(['src'], [{ file: 'a.ts', line: 2, severity: 'low', description: 'd' }], 'step 1')
    expect(text).toContain('[low] a.ts:2: d')
    expect(text).toContain('step 1')
  })
})
