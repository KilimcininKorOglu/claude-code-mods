import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProjectKey } from '../hooks/shared/layout.ts'
import type { ProjectRef, SetupJob, SetupStep } from '../hooks/shared/protocol.ts'
import type { Runtime } from './embedder.ts'
import type { Embeddings } from './embeddings.ts'
import { log, messageOf } from './log.ts'
import type { Store, Stores } from './stores.ts'

/**
 * `/sage-memory setup` as a job the daemon runs and the hooks module polls: install the package,
 * download the model (the one time the model may be fetched), then embed the memories of every
 * store on disk. One job runs at a time; a start while one runs answers the running one.
 */
export type Setup = {
  job: () => SetupJob
  start: () => SetupJob
  running: () => boolean
  /** Stops a running job (npm is killed) and settles once it ended. */
  stop: () => Promise<void>
}

export type SetupContext = { dir: string; runtime: Runtime; embeddings: Embeddings; stores: Stores }

/** The projects whose stores are on disk, from the `project.json` each store directory holds. */
function projectRefs(dir: string): ProjectRef[] {
  if (!existsSync(dir)) return []
  const refs: ProjectRef[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, 'project.json')
    if (!entry.isDirectory() || !isProjectKey(entry.name) || !existsSync(file)) continue
    const ref = JSON.parse(readFileSync(file, 'utf8')) as Partial<ProjectRef>
    if (ref.key !== entry.name || typeof ref.root !== 'string' || typeof ref.name !== 'string' || typeof ref.commonDir !== 'string') {
      throw new Error(`${file} does not describe the project store it sits in`)
    }
    refs.push({ key: ref.key, name: ref.name, root: ref.root, commonDir: ref.commonDir })
  }
  return refs
}

function storesOnDisk(context: SetupContext): Store[] {
  return [context.stores.global(), ...projectRefs(context.dir).map(ref => context.stores.project(ref))]
}

type Report = (step: SetupStep, detail: string) => void

async function work(context: SetupContext, report: Report, signal: AbortSignal): Promise<number> {
  report('install', 'npm install')
  if (!context.runtime.packageReady()) await context.runtime.install(line => report('install', line), signal)
  report('download', 'the model')
  if (context.embeddings.state().state !== 'ready' || !context.runtime.installed()) await context.embeddings.load(true, detail => report('download', detail))
  report('index', 'the stores on disk')
  const stores = storesOnDisk(context)
  let indexed = 0
  for (const [index, store] of stores.entries()) {
    if (signal.aborted) throw new Error('the setup was stopped')
    report('index', `${store.name} (${index + 1}/${stores.length})`)
    indexed += await context.embeddings.fill(store)
  }
  return indexed
}

export function createSetup(context: SetupContext): Setup {
  let job: SetupJob = { state: 'idle' }
  let run: Promise<void> | undefined
  let controller: AbortController | undefined

  const start = (): SetupJob => {
    if (run !== undefined) return job
    const startedAt = new Date().toISOString()
    const abort = new AbortController()
    let step: SetupStep = 'install'
    const report: Report = (next, detail) => {
      step = next
      job = { state: 'running', step, detail, startedAt }
    }
    report('install', 'starting')
    controller = abort
    run = work(context, report, abort.signal).then(
      indexed => {
        job = { state: 'done', indexed, startedAt, finishedAt: new Date().toISOString() }
        log(`setup: done, ${indexed} memories embedded`)
      },
      (err: unknown) => {
        job = { state: 'failed', step, error: messageOf(err), startedAt, finishedAt: new Date().toISOString() }
        log(`setup: the ${step} step failed: ${messageOf(err)}`)
      },
    )
    const settle = (): void => {
      run = undefined
      controller = undefined
    }
    run.then(settle, settle)
    return job
  }

  return {
    job: () => job,
    start,
    running: () => run !== undefined,
    stop: async () => {
      controller?.abort()
      await run
    },
  }
}
