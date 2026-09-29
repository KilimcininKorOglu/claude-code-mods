/**
 * The collab pipeline: scanner, planner and critic in turn, each waiting for its subagent's answer or its
 * time limit. Pure code: the hooks module hands in the engine calls as `Ports`, so tests can drive every
 * wait with fakes (the test engine starts no subagent).
 */
import { criticTask, handBackOf, plannerTask, reportText, scannerTask, verdictOf, type Finding, type Step, type StepResult } from './collab.ts'
import type { RoundEnd } from './round.ts'

export const STEP_MS: Record<Step, number> = { scanner: 600_000, planner: 480_000, critic: 360_000 }

/** A running collab: its paths, the step running, the agents it started, the scanner and what it found. */
export type CollabRun = { paths: string[]; step: Step; agents: Set<string>; scanner?: string; findings: Finding[]; launched: () => void }

type Waiter = (end: RoundEnd) => void

/** The collab run, the subagent answers a step waits for, and those that came before the wait. */
export type Waits = { collab: CollabRun | undefined; waiters: Map<string, Waiter>; early: Map<string, RoundEnd> }

/** What the pipeline needs from the engine. */
export type Ports = {
  /** Starts the step's subagent: its id, or why none started. */
  spawn: (step: Step, prompt: string) => Promise<{ agentId?: string; deny?: string }>
  /** Calls `fn` after `ms`, unless cancelled first. */
  after: (ms: number, fn: () => void) => { cancel: () => void }
  /** Redraws the standing section. */
  show: () => Promise<void>
  /** One line for the person. */
  tell: (text: string, kind: 'ok' | 'warn') => Promise<void>
}

/** Waits for a subagent's answer, or its step's time limit. */
export function answerOf(w: Waits, ports: Ports, agentId: string, ms: number): Promise<RoundEnd | undefined> {
  const early = w.early.get(agentId)
  if (early !== undefined) {
    w.early.delete(agentId)
    return Promise.resolve(early)
  }
  return new Promise(resolve => {
    const timer = ports.after(ms, () => {
      w.waiters.delete(agentId)
      resolve(undefined)
    })
    w.waiters.set(agentId, end => {
      timer.cancel()
      resolve(end)
    })
  })
}

async function runStep(w: Waits, ports: Ports, run: CollabRun, step: Step, prompt: string): Promise<StepResult> {
  run.step = step
  await ports.show()
  const spawned = await ports.spawn(step, prompt)
  if (spawned.deny !== undefined || spawned.agentId === undefined) return { step, status: 'failed', answer: '', reason: spawned.deny ?? 'no agent started' }
  run.agents.add(spawned.agentId)
  if (step === 'scanner') run.scanner = spawned.agentId
  run.launched()
  const end = await answerOf(w, ports, spawned.agentId, STEP_MS[step])
  if (end === undefined) return { step, status: 'timed-out', answer: '', reason: `no answer within ${STEP_MS[step] / 60_000} min` }
  if (end.reason !== 'answer') return { step, status: 'failed', answer: end.answer, reason: `ended with ${end.reason}` }
  return { step, status: 'done', answer: end.answer }
}

const skipped = (step: Step): StepResult => ({ step, status: 'skipped', answer: '', reason: 'the scanner produced nothing' })

/** Scanner, planner and critic in turn; each reads what the ones before it produced. The answer is the report. */
export async function runCollab(w: Waits, ports: Ports, paths: string[], launched: () => void): Promise<string> {
  const run: CollabRun = { paths, step: 'scanner', agents: new Set(), findings: [], launched }
  w.collab = run
  try {
    const scan = await runStep(w, ports, run, 'scanner', scannerTask(paths))
    if (scan.status !== 'done' && run.findings.length === 0) {
      return reportText(paths, run.findings, [scan, skipped('planner'), skipped('critic')], 'no-verdict')
    }
    const plan = await runStep(w, ports, run, 'planner', plannerTask(paths, run.findings, scan.answer))
    const critique = await runStep(w, ports, run, 'critic', criticTask(paths, run.findings, plan.answer))
    const verdict = critique.status === 'done' ? verdictOf(critique.answer) : 'no-verdict'
    await ports.tell(`collab finished: ${run.findings.length} finding(s), verdict ${verdict}`, verdict === 'approve' ? 'ok' : 'warn')
    return reportText(paths, run.findings, [scan, plan, critique], verdict)
  } finally {
    w.collab = undefined
    await ports.show()
  }
}

/** A subagent's turn end: a collab step waits for it, or it came before the wait began. */
export function settleAgent(w: Waits, agentId: string, end: RoundEnd): void {
  const waiter = w.waiters.get(agentId)
  if (waiter !== undefined) {
    w.waiters.delete(agentId)
    waiter(end)
  } else if (w.collab !== undefined) w.early.set(agentId, end)
}

/** Settles the collab step whose hand-back `text` is; false when it is no collab step's hand-back. */
export function takeHandBack(w: Waits, text: string): boolean {
  const back = handBackOf(text)
  if (back === undefined || w.collab?.agents.has(back.from) !== true) return false
  settleAgent(w, back.from, { reason: 'answer', isAborted: false, answer: back.report })
  return true
}
