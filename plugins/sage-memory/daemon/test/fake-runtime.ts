import type { Embedder, LoadOptions, Runtime } from '../embedder.ts'
import type { SemanticQuery } from '../vectors.ts'

/**
 * An embedding runtime for tests. Vectors have 16 numbers: a test sets the ones it compares in the
 * first eight (see `toward`), and every other text gets a vector of its own in the last eight, so
 * it never resembles a set one. `present` says whether setup installed it.
 */
export type FakeRuntime = Runtime & {
  vectors: Map<string, number[]>
  present: boolean
  /** The next embed call fails with this message. */
  failNext?: string
  /** The next load fails with this message. */
  failLoad?: string
  /** A load waits for this before it answers. */
  hold?: Promise<void>
  /** An embed call waits for this before it answers. */
  embedHold?: Promise<void>
  loads: LoadOptions[]
  /** Every text embedded, in order. */
  embedded: string[]
  installs: number
}

export const DIMS = 16

/** A vector at `cosine` to the unit vector of dimension `axis` (0 to 6), turned toward the next dimension. */
export function toward(axis: number, cosine: number): number[] {
  const values = new Array<number>(DIMS).fill(0)
  values[axis] = cosine
  values[axis + 1] = Math.sqrt(1 - cosine * cosine)
  return values
}

function normalized(values: readonly number[]): Float32Array {
  const length = Math.hypot(...values)
  return Float32Array.from(values, value => value / length)
}

/** A query vector of the fake model. */
export function queryOf(values: readonly number[]): SemanticQuery {
  return { modelId: 'fake/model', vector: normalized(values) }
}

/** An unset text's own direction in the last eight dimensions, from a hash of the text. */
function ownVector(text: string): number[] {
  let hash = 0
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  const values = new Array<number>(DIMS).fill(0)
  values[8 + (hash % 8)] = 1
  return values
}

export function fakeRuntime(present = true): FakeRuntime {
  const fake: FakeRuntime = {
    vectors: new Map(),
    present,
    loads: [],
    embedded: [],
    installs: 0,
    installed: () => fake.present,
    packageReady: () => fake.present,
    install: async () => {
      fake.installs++
      fake.present = true
    },
    load: async options => {
      fake.loads.push(options)
      await fake.hold
      const message = fake.failLoad
      fake.failLoad = undefined
      if (message !== undefined) throw new Error(message)
      return embedder
    },
  }
  const embedder: Embedder = {
    modelId: 'fake/model',
    dims: DIMS,
    embed: async texts => {
      await fake.embedHold
      const message = fake.failNext
      fake.failNext = undefined
      if (message !== undefined) throw new Error(message)
      fake.embedded.push(...texts)
      return texts.map(text => normalized(fake.vectors.get(text) ?? ownVector(text)))
    },
  }
  return fake
}
