export const OUTCOMES = ['fixed-and-verified', 'fixed-verification-incomplete', 'no-proven-bug', 'blocked'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** What the proof tool recorded in the running round. */
export type ProofState = { argv: string[]; failed: boolean; passed: boolean }

export type RoundRecord = { round: number; outcome: Outcome | 'none'; fingerprint?: string; note?: string }

/** One hunt: `rounds` rounds over `target`, the running round `round`. */
export type Hunt = {
  id: string
  round: number
  rounds: number
  target: string
  skill: boolean
  proof: ProofState | undefined
  history: RoundRecord[]
}

export type RoundEnd = { reason: string; isAborted: boolean; answer: string }

export type Verdict = { next: 'continue' } | { next: 'done' } | { next: 'stop'; reason: string }

/** A new hunt at its first round. */
export function newHunt(id: string, rounds: number, target: string): Hunt {
  return { id, round: 1, rounds, target, skill: false, proof: undefined, history: [] }
}

/** The id of the running round, used for its proof directory. */
export function roundId(hunt: Hunt): string {
  return `${hunt.id}-r${hunt.round}`
}

/**
 * The outcome label of the first line that begins with one, markdown marks stripped. The model sometimes
 * writes a sentence before the label (measured), so every line is read, not only the first.
 */
export function outcomeOf(answer: string): Outcome | undefined {
  for (const line of answer.split('\n')) {
    const bare = line.replace(/[*`#>_]/g, '').replace(/^\s*[-:]?\s*/, '').trim().toLowerCase()
    const hit = OUTCOMES.find(o => bare === o || new RegExp(`^${o}(?![\\w-])`).test(bare))
    if (hit !== undefined) return hit
  }
  return undefined
}

/** The `fingerprint:` line of a round's answer. */
export function fingerprintOf(answer: string): string | undefined {
  const m = /^[\s*`>-]*fingerprint[*`]*\s*:[*`\s]*(.+?)[`\s]*$/im.exec(answer)
  return m === null ? undefined : m[1]
}

/** Whether the hunt goes on after a round ended as `end` said. */
export function decide(hunt: Hunt, end: RoundEnd): Verdict {
  if (end.isAborted) return { next: 'stop', reason: 'the round was interrupted' }
  if (end.reason !== 'answer') return { next: 'stop', reason: `the round ended with ${end.reason}` }
  const outcome = outcomeOf(end.answer)
  if (outcome === undefined) return { next: 'stop', reason: 'the answer did not begin with an outcome line' }
  if (outcome === 'blocked' || outcome === 'fixed-verification-incomplete') return { next: 'stop', reason: `the round reported ${outcome}` }
  if (outcome === 'fixed-and-verified' && !proven(hunt.proof)) {
    return { next: 'stop', reason: 'the round reported fixed-and-verified, but the mod recorded no FAIL followed by a PASS' }
  }
  return hunt.round >= hunt.rounds ? { next: 'done' } : { next: 'continue' }
}

function proven(proof: ProofState | undefined): boolean {
  return proof !== undefined && proof.failed && proof.passed
}

/** Records the ended round and moves the hunt to the next one. */
export function advance(hunt: Hunt, answer: string): Hunt {
  const record: RoundRecord = { round: hunt.round, outcome: outcomeOf(answer) ?? 'none', fingerprint: fingerprintOf(answer) }
  return { ...hunt, round: hunt.round + 1, skill: false, proof: undefined, history: [...hunt.history, record] }
}

/** The fingerprints of the rounds so far. */
export function fingerprints(hunt: Hunt): string[] {
  return hunt.history.flatMap(r => (r.fingerprint === undefined ? [] : [r.fingerprint]))
}
