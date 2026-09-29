import type { EditRule } from './paths.ts'
import { fingerprints, type Hunt } from './round.ts'

export const SKILL = 'bughunt:bughunt'
export const PROOF_TOOL = 'mcp__bughunt__proof'

const PROTOCOL = [
  'Protocol (the bughunt skill has the full text):',
  '1. Survey: record the starting revision and dirty paths; keep other changes untouched.',
  `2. Prove: write a proof in the proof directory that runs the real code path, prints a FAIL line and exits non-zero; call ${PROOF_TOOL} with phase "before". Without a recorded FAIL, change no production code.`,
  '3. Fix the root cause with the smallest change.',
  `4. Verify: the same proof prints PASS and exits 0; call ${PROOF_TOOL} with phase "after" and the same argv. Add a regression test to the suite and run the checks.`,
  '5. Report: begin the answer with one line, fixed-and-verified, fixed-verification-incomplete, no-proven-bug or blocked, and give a "fingerprint: <file>:<symbol>: <cause>" line. Then stop.',
  'No subagents in a round. One root cause per round. Do not count a fingerprint listed below again.',
].join('\n')

/** The prompt that starts or continues a round. */
export function roundText(hunt: Hunt, dir: string): string {
  const seen = fingerprints(hunt)
  return [
    `Proof-driven bug hunt, round ${hunt.round}/${hunt.rounds}.`,
    `Scope: ${hunt.target === '' ? 'the whole project' : `${hunt.target} and everything under it`}.`,
    `Proof directory: ${dir}`,
    `First invoke the ${SKILL} skill with the Skill tool; edits are refused until it is open in this round.`,
    '',
    PROTOCOL,
    '',
    `Fingerprints of earlier rounds: ${seen.length === 0 ? 'none' : ''}`,
    ...seen.map(f => `- ${f}`),
  ].join('\n')
}

/** The block the skill text gets while a round runs. */
export function skillBlock(hunt: Hunt, dir: string): string {
  const seen = fingerprints(hunt)
  return [
    '',
    '## Current round (bughunt)',
    `Round ${hunt.round}/${hunt.rounds}. Scope: ${hunt.target === '' ? 'the whole project' : hunt.target}. Proof directory: ${dir}`,
    `Earlier fingerprints: ${seen.length === 0 ? 'none' : seen.join('; ')}`,
  ].join('\n')
}

const EDIT_DENY: Record<EditRule, (dir: string, target: string) => string> = {
  skill: () => `A bughunt round is running and the ${SKILL} skill is not open in it. Invoke it with the Skill tool first.`,
  proof: dir => `No FAIL is recorded in this round. Write the proof in ${dir} and call ${PROOF_TOOL} with phase "before"; production code stays unchanged until it fails.`,
  scope: (_, target) => `This file is outside the round's scope (${target}). Keep the fix inside the scope, or put a regression test in a test file.`,
}

export function editDenyText(rule: EditRule, dir: string, target: string): string {
  return `${EDIT_DENY[rule](dir, target)} There is no way around this gate; /bughunt stop ends the hunt.`
}

export const SPAWN_DENY = 'A bughunt round is running, and a round uses no subagents. Do the work in this conversation. There is no way around this gate; /bughunt stop ends the hunt.'

/** The one-line log of a stopped edit. */
export function editLog(rule: EditRule, path: string): string {
  return `edit stopped (${rule}): ${path}`
}

export function roundLine(hunt: Hunt): string {
  return `round ${hunt.round}/${hunt.rounds} started${hunt.target === '' ? '' : ` in ${hunt.target}`}`
}
