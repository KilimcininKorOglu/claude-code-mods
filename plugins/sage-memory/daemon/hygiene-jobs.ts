import type { HygieneOptions, HygieneReport, HygieneRun } from '../hooks/shared/model.ts'
import { transcriptsDirOf, verifyScopeOf } from './claude-dirs.ts'
import type { Embeddings } from './embeddings.ts'
import { runHygiene, type HygieneJob } from './hygiene.ts'
import { log, messageOf } from './log.ts'
import { opFor, type Places } from './places.ts'
import { audit, sql } from './rows.ts'
import { transaction, type Store } from './stores.ts'

/**
 * Hygiene runs, one at a time per store. An automatic run (a session ended) starts in the
 * background, at most once an hour per store, counted from the last automatic report the store's
 * audit log holds, so a daemon started again keeps the pace. A run the person or the model asks
 * for waits for a running one, then runs and answers its report.
 */

export type HygieneRequest = { automatic: boolean; options: HygieneOptions }

export type Hygiene = {
  run: (places: Places, request: HygieneRequest) => Promise<{ project: HygieneRun; user: HygieneRun }>
  running: () => boolean
  /** Stops every run between its steps and settles once none runs. */
  stop: () => Promise<void>
}

const AUTOMATIC_EVERY_MS = 60 * 60_000

const LAST_AUTOMATIC = `
  SELECT at FROM audit_log
  WHERE action = 'memory.hygiene_completed' AND json_extract(detail, '$.automatic') = 1
  ORDER BY id DESC LIMIT 1`

type State = { dir: string; embeddings: Embeddings; jobs: Map<string, Promise<HygieneReport>>; stopping: boolean }

/** Records a failed run in the daemon log and the store's audit log, where a background run's failure can be read. */
async function recordFailure(job: HygieneJob, err: unknown): Promise<void> {
  const error = messageOf(err)
  log(`hygiene: ${job.op.store.name}: ${error}`)
  try {
    await transaction(job.op.store, () => audit(job.op.store, job.op.now, 'memory.hygiene_failed', { detail: { automatic: job.automatic, error } }))
  } catch (auditErr) {
    log(`hygiene: ${job.op.store.name}: the failure could not be recorded in the audit log: ${messageOf(auditErr)}`)
  }
}

/** Starts a run; the store counts it as pending, so it is not closed as idle while the run lasts. */
function start(state: State, job: HygieneJob): Promise<HygieneReport> {
  const store = job.op.store
  store.pending++
  const run = runHygiene(job)
  run.catch((err: unknown) => recordFailure(job, err))
  state.jobs.set(store.name, run)
  const settle = (): void => {
    store.pending--
    if (state.jobs.get(store.name) === run) state.jobs.delete(store.name)
  }
  run.then(settle, settle)
  return run
}

function jobFor(state: State, places: Places, store: Store, request: HygieneRequest): HygieneJob {
  return {
    op: opFor(places, store),
    scope: verifyScopeOf(state.dir, places, store),
    transcripts: store === places.project ? transcriptsDirOf(state.dir) : undefined,
    embeddings: state.embeddings,
    options: request.options,
    automatic: request.automatic,
    stopping: () => state.stopping,
  }
}

function startAutomatic(state: State, places: Places, store: Store, request: HygieneRequest): HygieneRun {
  if (state.jobs.has(store.name)) return { state: 'running' }
  const lastAt = (sql(store.db, LAST_AUTOMATIC).get() as { at: string } | undefined)?.at
  if (lastAt !== undefined && Date.parse(places.now) - Date.parse(lastAt) < AUTOMATIC_EVERY_MS) return { state: 'recent', lastAt }
  void start(state, jobFor(state, places, store, request))
  return { state: 'started' }
}

async function runIn(state: State, places: Places, store: Store, request: HygieneRequest): Promise<HygieneRun> {
  if (request.automatic) return startAutomatic(state, places, store, request)
  const running = state.jobs.get(store.name)
  // Waits for the running one to end; its own handler records a failure.
  if (running) await running.then(
    () => undefined,
    () => undefined,
  )
  return { state: 'done', report: await start(state, jobFor(state, places, store, request)) }
}

export function createHygiene(context: { dir: string; embeddings: Embeddings }): Hygiene {
  const state: State = { dir: context.dir, embeddings: context.embeddings, jobs: new Map(), stopping: false }
  return {
    run: async (places, request) => {
      const project = await runIn(state, places, places.project, request)
      return { project, user: await runIn(state, places, places.global, request) }
    },
    running: () => state.jobs.size > 0,
    stop: async () => {
      state.stopping = true
      await Promise.allSettled([...state.jobs.values()])
    },
  }
}
