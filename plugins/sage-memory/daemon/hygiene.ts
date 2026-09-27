import { VERIFY_DEPTHS, type HygieneOptions, type HygieneReport } from '../hooks/shared/model.ts'
import { keptTranscripts } from './claude-dirs.ts'
import { forgetSessions, recordedSessions } from './contexts.ts'
import { mergeExact, mergeNear } from './dedupe.ts'
import type { Embeddings } from './embeddings.ts'
import { refused } from './errors.ts'
import { storeLabel, type Op } from './op.ts'
import { flagContradictions, purgeDeleted, reviewAndCollect, type ReviewLimits } from './reviews.ts'
import { audit, selectMemories } from './rows.ts'
import { transaction } from './stores.ts'
import { writeVerifications } from './verdicts.ts'
import { verifyMemories, type VerifyScope } from './verify.ts'

/**
 * One hygiene run over one store, in SAGE's order: verify the anchors, merge exact and near
 * duplicates, flag contradictions, open reviews and delete expired session memories, drop the
 * reminder records of the sessions Claude Code no longer keeps, remove old tombstones, and record
 * the report. Each step writes in transactions of its own, so requests run between them, and the
 * run stops between steps once the daemon closes.
 */

export type HygieneJob = {
  op: Op
  scope: VerifyScope
  /** Claude Code's transcripts directory, for the project store; the global store keeps no reminder records. */
  transcripts?: string
  embeddings: Embeddings
  options: HygieneOptions
  automatic: boolean
  stopping: () => boolean
}

const DAY_MS = 86_400_000

/** The memories whose anchors hygiene checks: the active ones, and the ones verification made stale. */
const VERIFIABLE = `
  SELECT id, data FROM memories
  WHERE json_array_length(data, '$.anchors') > 0
    AND (status = 'active' OR (status = 'stale' AND json_extract(data, '$.staleReason') = 'verification'))
  ORDER BY id`

function limitsOf(options: HygieneOptions): ReviewLimits {
  return {
    staleMs: (options.staleReviewDays ?? 90) * DAY_MS,
    lowConfidenceMs: (options.lowConfidenceReviewDays ?? 30) * DAY_MS,
    unusedMs: (options.unusedReviewDays ?? 30) * DAY_MS,
    minReminders: options.unusedMinReminders ?? 10,
    sessionRetentionMs: (options.sessionRetentionDays ?? 7) * DAY_MS,
  }
}

type Step = (job: HygieneJob, report: HygieneReport) => Promise<void>

const verifyStep: Step = async (job, report) => {
  if (report.depth === 'off') return
  const memories = selectMemories(job.op.store.db, VERIFIABLE)
  const checks = await verifyMemories(job.scope, memories, report.depth, job.op.now, job.stopping)
  const applied = await writeVerifications(job.op, checks)
  report.checked = checks.length
  report.verified = applied.verified
  report.staled = applied.staled.length
  report.reactivated = applied.reactivated.length
}

const exactStep: Step = async (job, report) => {
  report.merged = await transaction(job.op.store, () => mergeExact(job.op))
}

/** A survivor that took a longer text is embedded again once the merge committed. */
const nearStep: Step = async (job, report) => {
  if (job.options.nearDedup === false) return
  const near = await transaction(job.op.store, () => mergeNear(job.op))
  report.nearMerged = near.merged
  report.rewritten = near.rewritten.length
  await job.embeddings.afterWrite(job.op.store, near.rewritten)
}

const contradictionStep: Step = async (job, report) => {
  const flagged = await transaction(job.op.store, () => flagContradictions(job.op))
  report.contradictions = flagged.contradictions
  report.reviewsOpened += flagged.reviews
}

const reviewStep: Step = async (job, report) => {
  const reviewed = await transaction(job.op.store, () => reviewAndCollect(job.op, limitsOf(job.options)))
  report.reviewsOpened += reviewed.reviews
  report.sessionDeleted = reviewed.sessionDeleted
}

/**
 * Drops the reminder records of the sessions whose transcripts Claude Code deleted. The sessions
 * are read before the transcripts, so a session that starts meanwhile is never among them; when
 * the transcripts cannot be read, every record stays.
 */
const remindersStep: Step = async (job, report) => {
  if (job.transcripts === undefined) return
  const recorded = recordedSessions(job.op.store.db)
  if (recorded.length === 0) return
  const kept = await keptTranscripts(job.transcripts)
  if ('error' in kept) {
    report.notes.push(`the reminder records stay: ${kept.error}`)
    return
  }
  const gone = recorded.filter(id => !kept.ids.has(id))
  report.sessionsForgotten = await transaction(job.op.store, () => forgetSessions(job.op, gone))
}

const purgeStep: Step = async (job, report) => {
  const days = job.options.purgeDeletedAfterDays
  if (days === undefined) return
  const cutoff = new Date(Date.parse(job.op.now) - days * DAY_MS).toISOString()
  report.purged = await transaction(job.op.store, () => purgeDeleted(job.op, cutoff))
}

const STEPS: readonly Step[] = [verifyStep, exactStep, nearStep, contradictionStep, reviewStep, remindersStep, purgeStep]

function emptyReport(job: HygieneJob): HygieneReport {
  return {
    store: storeLabel(job.op.store),
    automatic: job.automatic,
    startedAt: job.op.now,
    completedAt: job.op.now,
    depth: job.options.verify === false ? 'off' : (job.options.verifyDepth ?? 'existence'),
    checked: 0,
    verified: 0,
    staled: 0,
    reactivated: 0,
    merged: 0,
    nearMerged: 0,
    rewritten: 0,
    contradictions: 0,
    reviewsOpened: 0,
    sessionDeleted: 0,
    purged: 0,
    sessionsForgotten: 0,
    notes: [],
  }
}

/** Runs every step on the job's store and records the report in its audit log. */
export async function runHygiene(job: HygieneJob): Promise<HygieneReport> {
  const report = emptyReport(job)
  for (const step of STEPS) {
    if (job.stopping()) {
      report.stopped = true
      break
    }
    await step(job, report)
  }
  report.completedAt = new Date().toISOString()
  const action = report.stopped === true ? 'memory.hygiene_stopped' : 'memory.hygiene_completed'
  await transaction(job.op.store, () => audit(job.op.store, job.op.now, action, { detail: report }))
  return report
}

const DAY_FIELDS = ['staleReviewDays', 'lowConfidenceReviewDays', 'unusedReviewDays', 'sessionRetentionDays', 'purgeDeletedAfterDays'] as const
const OPTION_KEYS: ReadonlySet<string> = new Set([...DAY_FIELDS, 'verify', 'verifyDepth', 'nearDedup', 'unusedMinReminders'])

function checkFlags(options: Record<string, unknown>): void {
  for (const key of ['verify', 'nearDedup']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw refused(`options.${key} must be true or false`)
  }
  if (options.verifyDepth !== undefined && !(VERIFY_DEPTHS as readonly unknown[]).includes(options.verifyDepth)) {
    throw refused(`options.verifyDepth must be one of: ${VERIFY_DEPTHS.join(', ')}`)
  }
}

const isDays = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value > 0

const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 1

function checkNumbers(options: Record<string, unknown>): void {
  const wrongDays = DAY_FIELDS.find(key => options[key] !== undefined && !isDays(options[key]))
  if (wrongDays !== undefined) throw refused(`options.${wrongDays} must be a number of days above 0`)
  if (options.unusedMinReminders !== undefined && !isCount(options.unusedMinReminders)) throw refused('options.unusedMinReminders must be a whole number from 1')
}

/** The options of a hygiene request, every field checked; a field it does not know is refused. */
export function checkedOptions(options: Record<string, unknown> | undefined): HygieneOptions {
  if (options === undefined) return {}
  const unknownKey = Object.keys(options).find(key => !OPTION_KEYS.has(key))
  if (unknownKey !== undefined) throw refused(`options take no ${unknownKey}`)
  checkFlags(options)
  checkNumbers(options)
  return options as HygieneOptions
}
