import type { ProofState } from './round.ts'

export type Phase = 'before' | 'after'
export type ProofRun = { exitCode: number; stdout: string; stderr: string }
export type ProofJudgement = { accepted: boolean; reason: string; state: ProofState | undefined }

const FAIL_LINE = /^\s*FAIL\b/m
const PASS_LINE = /^\s*PASS\b/m
const TAIL_LINES = 20

/** The input of the proof tool, or the reason it is refused. */
export function proofInput(e: { phase?: unknown; argv?: unknown; cwd?: unknown }): { phase: Phase; argv: string[]; cwd?: string } | string {
  if (e.phase !== 'before' && e.phase !== 'after') return 'phase must be "before" or "after"'
  if (!Array.isArray(e.argv) || e.argv.length === 0 || !e.argv.every(a => typeof a === 'string')) return 'argv must be a non-empty array of strings'
  if (e.cwd !== undefined && typeof e.cwd !== 'string') return 'cwd must be a string'
  return { phase: e.phase, argv: e.argv, cwd: e.cwd }
}

/** Judges one run of the proof command against the round's record. */
export function judgeProof(phase: Phase, argv: string[], run: ProofRun, state: ProofState | undefined): ProofJudgement {
  return phase === 'before' ? judgeBefore(argv, run, state) : judgeAfter(argv, run, state)
}

function judgeBefore(argv: string[], run: ProofRun, state: ProofState | undefined): ProofJudgement {
  const out = `${run.stdout}\n${run.stderr}`
  if (run.exitCode === 0) return { accepted: false, reason: 'the proof exited 0, so it does not show the bug', state }
  if (!FAIL_LINE.test(out)) return { accepted: false, reason: 'the proof exited non-zero but printed no line starting with FAIL', state }
  return { accepted: true, reason: 'FAIL recorded', state: { argv, failed: true, passed: false } }
}

function judgeAfter(argv: string[], run: ProofRun, state: ProofState | undefined): ProofJudgement {
  if (state === undefined || !state.failed) return { accepted: false, reason: 'no FAIL was recorded in this round; run phase "before" first', state }
  if (JSON.stringify(argv) !== JSON.stringify(state.argv)) return { accepted: false, reason: `argv differs from the recorded proof ${JSON.stringify(state.argv)}`, state }
  const out = `${run.stdout}\n${run.stderr}`
  if (run.exitCode !== 0) return { accepted: false, reason: `the proof still exits ${run.exitCode}`, state }
  if (!PASS_LINE.test(out)) return { accepted: false, reason: 'the proof exited 0 but printed no line starting with PASS', state }
  return { accepted: true, reason: 'PASS recorded', state: { ...state, passed: true } }
}

/** The last lines of a run's output, for the model. */
export function tailOf(run: ProofRun): string {
  const lines = `${run.stdout}${run.stderr === '' ? '' : `\n${run.stderr}`}`.trimEnd().split('\n')
  return lines.slice(-TAIL_LINES).join('\n')
}
