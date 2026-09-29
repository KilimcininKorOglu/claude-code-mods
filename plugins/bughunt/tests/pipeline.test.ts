import { describe, expect, test, tier } from 'claude-code/testing'

import type { Step } from '../hooks/collab.ts'
import { runCollab, settleAgent, STEP_MS, takeHandBack, type Ports, type Waits } from '../hooks/pipeline.ts'

tier('user')

/**
 * Fake engine calls: each spawn answers the next id in `ids` (undefined: none started) and resolves the
 * test's wait for it; timers fire only when the test fires them; the person's lines are kept.
 */
function fakes(ids: Partial<Record<Step, string>> = { scanner: 'a-scan', planner: 'a-plan', critic: 'a-crit' }) {
  const w: Waits = { collab: undefined, waiters: new Map(), early: new Map() }
  const timers = new Map<number, { ms: number; fn: () => void }>()
  const told: string[] = []
  const prompts: Partial<Record<Step, string>> = {}
  let next = 0
  let spawned: (step: Step) => void = () => {}
  let onSpawn: ((step: Step) => void) | undefined
  const ports: Ports = {
    spawn: async (step, prompt) => {
      prompts[step] = prompt
      onSpawn?.(step)
      void Promise.resolve().then(() => spawned(step))
      return ids[step] === undefined ? {} : { agentId: ids[step] }
    },
    after: (ms, fn) => {
      const id = next++
      timers.set(id, { ms, fn })
      return { cancel: () => { timers.delete(id) } }
    },
    show: async () => {},
    tell: async text => { told.push(text) },
  }
  /** Resolves once `step` was spawned and its wait began. */
  const spawnOf = (step: Step) => new Promise<void>(resolve => {
    spawned = s => { if (s === step) afterMicrotasks(resolve) }
  })
  return { w, ports, timers, told, prompts, spawnOf, setOnSpawn: (f: (step: Step) => void) => { onSpawn = f } }
}

/** Resolves after the pending microtasks, so a step's wait has begun. */
function afterMicrotasks(resolve: () => void): void {
  void Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(resolve)
}

const handBack = (id: string, report: string) => `<agent-message from="${id}">\nThe report follows:\n${report.split('\n').map(l => `  ${l}`).join('\n')}\n</agent-message>`
const launched = () => {}

describe('the collab pipeline', () => {
  test('each step waits for its hand-back, reads the steps before it, and the critic\'s verdict ends the report', async () => {
    const f = fakes()
    const report = runCollab(f.w, f.ports, ['src'], launched)
    await f.spawnOf('scanner')
    f.w.collab?.findings.push({ file: 'src/a.ts', line: 4, severity: 'high', description: 'off by one' })
    expect(takeHandBack(f.w, handBack('a-scan', 'scanned src'))).toBe(true)
    await f.spawnOf('planner')
    expect(f.prompts.planner).toContain('- [high] src/a.ts:4: off by one')
    expect(f.prompts.planner).toContain('scanned src')
    expect(takeHandBack(f.w, handBack('a-plan', 'fix the bound'))).toBe(true)
    await f.spawnOf('critic')
    expect(f.prompts.critic).toContain('fix the bound')
    expect(takeHandBack(f.w, handBack('a-crit', 'verdict: approve\nthe plan holds'))).toBe(true)
    const text = await report
    expect(text).toContain('Verdict: approve')
    expect(text).toContain('- scanner: done\n- planner: done\n- critic: done')
    expect(f.told).toEqual(['collab finished: 1 finding(s), verdict approve'])
    expect(f.timers.size).toBe(0)
    expect(f.w.collab).toBeUndefined()
  })

  test('an answer that comes before the wait begins is kept and read', async () => {
    const f = fakes()
    f.setOnSpawn(step => {
      const id = { scanner: 'a-scan', planner: 'a-plan', critic: 'a-crit' }[step]
      f.w.collab?.agents.add(id)
      takeHandBack(f.w, handBack(id, step === 'critic' ? 'verdict: revise' : `${step} done`))
    })
    const text = await runCollab(f.w, f.ports, ['src'], launched)
    expect(text).toContain('Verdict: revise')
    expect(f.w.early.size).toBe(0)
  })

  test('a step past its time limit is named timed-out, and the findings so far stay in the report', async () => {
    const f = fakes()
    const report = runCollab(f.w, f.ports, ['src'], launched)
    await f.spawnOf('scanner')
    f.w.collab?.findings.push({ file: 'src/a.ts', line: 4, severity: 'low', description: 'd' })
    const [timer] = [...f.timers.values()]
    expect(timer?.ms).toBe(STEP_MS.scanner)
    timer?.fn()
    await f.spawnOf('planner')
    expect(takeHandBack(f.w, handBack('a-plan', 'plan'))).toBe(true)
    await f.spawnOf('critic')
    for (const t of f.timers.values()) t.fn()
    const text = await report
    expect(text).toContain('- scanner: timed-out (no answer within 10 min)')
    expect(text).toContain('- critic: timed-out (no answer within 6 min)')
    expect(text).toContain('## Findings (1)')
    expect(text).toContain('Verdict: no-verdict (the critic gave no verdict line; this is not an approval)')
  })

  test('a scanner that ended with an error and found nothing skips the other steps', async () => {
    const f = fakes()
    const report = runCollab(f.w, f.ports, ['src'], launched)
    await f.spawnOf('scanner')
    settleAgent(f.w, 'a-scan', { reason: 'error', isAborted: false, answer: '' })
    const text = await report
    expect(text).toContain('- scanner: failed (ended with error)')
    expect(text).toContain('- planner: skipped (the scanner produced nothing)')
    expect(f.prompts.planner).toBeUndefined()
  })

  test('a critic answer without a verdict line is no-verdict, never an approval', async () => {
    const f = fakes()
    const report = runCollab(f.w, f.ports, ['src'], launched)
    await f.spawnOf('scanner')
    f.w.collab?.findings.push({ file: 'src/a.ts', line: 4, severity: 'low', description: 'd' })
    takeHandBack(f.w, handBack('a-scan', 's'))
    await f.spawnOf('planner')
    takeHandBack(f.w, handBack('a-plan', 'p'))
    await f.spawnOf('critic')
    takeHandBack(f.w, handBack('a-crit', 'looks fine to me'))
    expect(await report).toContain('Verdict: no-verdict')
    expect(f.told).toEqual(['collab finished: 1 finding(s), verdict no-verdict'])
  })

  test('a hand-back of an agent the run did not start is not taken, nor one after the run ended', async () => {
    const f = fakes({ scanner: undefined })
    expect(await runCollab(f.w, f.ports, ['src'], launched)).toContain('- scanner: failed (no agent started)')
    expect(takeHandBack(f.w, handBack('a-scan', 'late'))).toBe(false)
    settleAgent(f.w, 'a-scan', { reason: 'error', isAborted: false, answer: '' })
    expect(f.w.early.size).toBe(0)
    expect(takeHandBack(f.w, 'plain text')).toBe(false)
  })
})
