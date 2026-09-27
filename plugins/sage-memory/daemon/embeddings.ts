import type { Memory } from '../hooks/shared/model.ts'
import type { EmbedState } from '../hooks/shared/protocol.ts'
import type { Embedder, Runtime } from './embedder.ts'
import { log, messageOf } from './log.ts'
import { transaction, type Store } from './stores.ts'
import { dropOrphanVectors, storeVectors, textHash, unembedded, type SemanticQuery } from './vectors.ts'

/**
 * The daemon's embeddings: the model, loaded at its first use once setup installed it and run one
 * inference at a time; the vector of each memory a write leaves; and a fill that embeds what a
 * store still lacks, once per store while the model is loaded. A failure becomes the `failed`
 * state and a log line, and ends vector search until the next setup or daemon start; the text
 * index keeps answering meanwhile.
 */
export type Embeddings = {
  state: () => EmbedState
  /** The query's vector, or undefined while embeddings are not ready; the stores named are filled in the background. */
  semantic: (text: string, stores: readonly Store[]) => Promise<SemanticQuery | undefined>
  /** Embeds the active and stale memories a write left. */
  afterWrite: (store: Store, memories: readonly Memory[]) => Promise<void>
  /** Embeds every memory of the store that lacks a current vector; answers how many. */
  fill: (store: Store) => Promise<number>
  /** Loads the model again, downloading its files when `allowRemote`; for setup. */
  load: (allowRemote: boolean, onProgress: (detail: string) => void) => Promise<Embedder>
  /** Whether a load or a fill runs, so the daemon does not close under it. */
  busy: () => boolean
  /** Stops the fills at their next slice and settles once none runs. */
  close: () => Promise<void>
}

type Core = {
  runtime: Runtime
  embedder?: Embedder
  loading?: Promise<Embedder>
  failed?: string
  closing: boolean
  /** The inference queue: one embed call at a time. */
  queue: Promise<unknown>
  /** The stores filled since the model loaded. */
  filled: Set<string>
  /** The fills that run, by store name. */
  fills: Map<string, Promise<number>>
}

type Made = { id: string; hash: string; vector: Float32Array }

/** A fill embeds this many memories between two writes, so a query waits one slice at most. */
const FILL_SLICE = 32

function fail(core: Core, what: string, err: unknown): void {
  core.failed = `${what} failed: ${messageOf(err)}`
  core.embedder = undefined
  log(`embeddings: ${core.failed}`)
}

function startLoad(core: Core, allowRemote: boolean, onProgress: (detail: string) => void): Promise<Embedder> {
  core.failed = undefined
  const run = core.runtime.load({ allowRemote, onProgress }).then(
    loaded => {
      core.embedder = loaded
      core.filled.clear()
      log(`embeddings: ${loaded.modelId} loaded, ${loaded.dims} dimensions`)
      return loaded
    },
    (err: unknown) => {
      fail(core, 'loading the model', err)
      throw err
    },
  )
  core.loading = run
  const settle = (): void => {
    if (core.loading === run) core.loading = undefined
  }
  run.then(settle, settle)
  return run
}

/** The loaded model, loading it when setup installed it; undefined while it cannot be used, the reason kept in `failed`. */
async function ready(core: Core): Promise<Embedder | undefined> {
  if (core.failed !== undefined) return undefined
  if (core.embedder !== undefined) return core.embedder
  if (core.loading === undefined && !core.runtime.installed()) return undefined
  return (core.loading ?? startLoad(core, false, () => undefined)).catch(() => undefined)
}

/** One inference at a time; a failed one does not stop the next. */
function infer(core: Core, model: Embedder, texts: readonly string[]): Promise<Float32Array[]> {
  const run = core.queue.then(() => model.embed(texts))
  core.queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function embedInto(core: Core, store: Store, model: Embedder, memories: readonly Memory[]): Promise<number> {
  const vectors = await infer(core, model, memories.map(memory => memory.text))
  const made: Made[] = memories.flatMap((memory, index) => {
    const vector = vectors[index]
    return vector === undefined ? [] : [{ id: memory.id, hash: textHash(memory.text), vector }]
  })
  return transaction(store, () => storeVectors(store.db, model.modelId, made))
}

async function runFill(core: Core, store: Store, model: Embedder): Promise<number> {
  await transaction(store, () => dropOrphanVectors(store.db))
  const todo = unembedded(store.db, model.modelId)
  let written = 0
  for (let start = 0; start < todo.length && !core.closing; start += FILL_SLICE) {
    written += await embedInto(core, store, model, todo.slice(start, start + FILL_SLICE))
  }
  if (written > 0) log(`embeddings: ${store.name}: ${written} memories embedded`)
  return written
}

/** One fill per store at a time: a second call while one runs answers the running one. */
function fill(core: Core, store: Store): Promise<number> {
  const running = core.fills.get(store.name)
  if (running) return running
  const run = ready(core).then(model => (model === undefined ? 0 : runFill(core, store, model)))
  run.catch((err: unknown) => fail(core, `embedding the memories of ${store.name}`, err))
  core.fills.set(store.name, run)
  store.pending++
  const settle = (): void => {
    core.fills.delete(store.name)
    store.pending--
  }
  run.then(settle, settle)
  return run
}

/** Starts a store's fill once per loaded model; a failure is already the `failed` state. */
function touch(core: Core, store: Store): void {
  if (core.embedder === undefined || core.filled.has(store.name) || core.closing) return
  core.filled.add(store.name)
  fill(core, store).catch((err: unknown) => log(`embeddings: the background fill of ${store.name} stopped: ${messageOf(err)}`))
}

async function semantic(core: Core, text: string, stores: readonly Store[]): Promise<SemanticQuery | undefined> {
  if (text.trim() === '') return undefined
  const model = await ready(core)
  if (model === undefined) return undefined
  stores.forEach(store => touch(core, store))
  try {
    const [vector] = await infer(core, model, [text])
    return vector === undefined ? undefined : { modelId: model.modelId, vector }
  } catch (err) {
    fail(core, 'embedding a query', err)
    return undefined
  }
}

/** A write succeeds whatever its embedding does: a failure becomes the state, and a later fill embeds the memory. */
async function afterWrite(core: Core, store: Store, memories: readonly Memory[]): Promise<void> {
  const searchable = memories.filter(memory => memory.status === 'active' || memory.status === 'stale')
  if (searchable.length === 0) return
  const model = await ready(core)
  if (model === undefined) return
  try {
    await embedInto(core, store, model, searchable)
  } catch (err) {
    fail(core, `embedding a memory of ${store.name}`, err)
  }
}

function stateOf(core: Core): EmbedState {
  if (core.failed !== undefined) return { state: 'failed', error: core.failed }
  if (core.embedder !== undefined) return { state: 'ready', modelId: core.embedder.modelId, dims: core.embedder.dims }
  if (core.loading !== undefined) return { state: 'loading' }
  return core.runtime.installed() ? { state: 'available' } : { state: 'off' }
}

export function createEmbeddings(runtime: Runtime): Embeddings {
  const core: Core = { runtime, closing: false, queue: Promise.resolve(), filled: new Set(), fills: new Map() }
  return {
    state: () => stateOf(core),
    semantic: (text, stores) => semantic(core, text, stores),
    afterWrite: (store, memories) => afterWrite(core, store, memories),
    fill: store => fill(core, store),
    load: (allowRemote, onProgress) => startLoad(core, allowRemote, onProgress),
    busy: () => core.loading !== undefined || core.fills.size > 0,
    close: async () => {
      core.closing = true
      await Promise.allSettled([...core.fills.values(), ...(core.loading ? [core.loading] : [])])
    },
  }
}
