import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import type { Layout } from '../hooks/shared/layout.ts'
import { EMBED_MODEL, TRANSFORMERS_VERSION } from '../hooks/shared/protocol.ts'
import { writeAtomic } from './files.ts'

/** Turns texts into normalized vectors of `dims` numbers, in the order given. */
export type Embedder = { modelId: string; dims: number; embed: (texts: readonly string[]) => Promise<Float32Array[]> }

export type LoadOptions = { allowRemote: boolean; onProgress: (detail: string) => void }

/**
 * What `/sage-memory setup` installs and the daemon loads: transformers.js and the multilingual
 * model under `runtime/`. A test hands the daemon one of its own.
 */
export type Runtime = {
  /** Whether the package and every file of the model are in place. */
  installed: () => boolean
  /** Whether the package alone is in place, at the pinned version. */
  packageReady: () => boolean
  /** Installs the package, passing each output line on; the signal stops it. */
  install: (onLine: (line: string) => void, signal: AbortSignal) => Promise<void>
  /** Loads the model; `allowRemote` lets it download the model's files, which only setup does. */
  load: (options: LoadOptions) => Promise<Embedder>
}

const PACKAGE = '@huggingface/transformers'
/** The files the model loads, where transformers.js caches them under the models directory. */
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
/** npm install gets this long before it is stopped. */
const INSTALL_TIMEOUT_MS = 10 * 60_000
/** How many texts one inference embeds; a larger batch holds more memory at once. */
const BATCH = 16
/** The last lines of npm's output a failed install reports. */
const TAIL_LINES = 5

type Tensor = { dims: number[]; data: Float32Array }
type Extractor = (texts: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<Tensor>
type Progress = { status: string; file?: string; progress?: number }
type Transformers = {
  env: { cacheDir: string; localModelPath: string; allowRemoteModels: boolean; allowLocalModels: boolean }
  pipeline: (task: 'feature-extraction', model: string, options: { dtype: 'q8'; device: 'cpu'; progress_callback: (progress: Progress) => void }) => Promise<Extractor>
}

function packageDir(layout: Layout): string {
  return join(layout.runtimeDir, 'node_modules', ...PACKAGE.split('/'))
}

type PackageJson = { version?: string; exports?: { node?: { import?: { default?: string } } } }

function packageJson(layout: Layout): PackageJson | undefined {
  const file = join(packageDir(layout), 'package.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PackageJson) : undefined
}

function packageReady(layout: Layout): boolean {
  return packageJson(layout)?.version === TRANSFORMERS_VERSION
}

function modelPresent(layout: Layout): boolean {
  return MODEL_FILES.every(file => existsSync(join(layout.modelsDir, EMBED_MODEL, file)))
}

/** The package's ES module entry for Node, as its `exports` names it. */
function entryOf(layout: Layout): string {
  const entry = packageJson(layout)?.exports?.node?.import?.default
  if (entry === undefined) throw new Error(`${PACKAGE} in ${layout.runtimeDir} names no Node import entry`)
  return join(packageDir(layout), entry)
}

function rowsOf(tensor: Tensor): Float32Array[] {
  const [count = 0, dims = 0] = tensor.dims
  return Array.from({ length: count }, (_, row) => tensor.data.slice(row * dims, (row + 1) * dims))
}

function progressOf(onProgress: (detail: string) => void): (progress: Progress) => void {
  return progress => {
    if (progress.status === 'progress' && progress.file !== undefined) onProgress(`${progress.file} ${Math.round(progress.progress ?? 0)}%`)
  }
}

async function load(layout: Layout, options: LoadOptions): Promise<Embedder> {
  const transformers = (await import(pathToFileURL(entryOf(layout)).href)) as Transformers
  // The download cache and the local model path are one directory: a model setup downloaded is
  // read from there as a local model, and transformers.js refuses a load with both sources off.
  transformers.env.cacheDir = layout.modelsDir
  transformers.env.localModelPath = layout.modelsDir
  transformers.env.allowLocalModels = true
  transformers.env.allowRemoteModels = options.allowRemote
  const extract = await transformers.pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8', device: 'cpu', progress_callback: progressOf(options.onProgress) })
  const embed = async (texts: readonly string[]): Promise<Float32Array[]> => {
    const vectors: Float32Array[] = []
    for (let start = 0; start < texts.length; start += BATCH) {
      vectors.push(...rowsOf(await extract(texts.slice(start, start + BATCH), { pooling: 'mean', normalize: true })))
    }
    return vectors
  }
  const [probe] = await embed(['sage-memory'])
  if (probe === undefined) throw new Error(`${EMBED_MODEL} gave no vector for a probe text`)
  return { modelId: EMBED_MODEL, dims: probe.length, embed }
}

/** Runs npm with the environment SAGE's README asks for, keeping the last lines for a failure's message. */
function runNpm(args: readonly string[], onLine: (line: string) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: INSTALL_TIMEOUT_MS, signal })
    const tail: string[] = []
    const take = (line: string): void => {
      if (line.trim() === '') return
      tail.push(line.trim())
      if (tail.length > TAIL_LINES) tail.shift()
      onLine(line.trim())
    }
    createInterface({ input: child.stdout }).on('line', take)
    createInterface({ input: child.stderr }).on('line', take)
    child.once('error', err => reject(new Error(`npm install did not run: ${err.message}`)))
    child.once('close', (code, killedBy) => {
      if (code === 0) resolve()
      else reject(new Error(`npm install ${killedBy === null ? `exited with code ${code}` : `was stopped by ${killedBy}`}: ${tail.join(' | ')}`))
    })
  })
}

function install(layout: Layout, onLine: (line: string) => void, signal: AbortSignal): Promise<void> {
  mkdirSync(layout.runtimeDir, { recursive: true, mode: 0o700 })
  const manifest = join(layout.runtimeDir, 'package.json')
  if (!existsSync(manifest)) writeAtomic(manifest, `${JSON.stringify({ name: 'sage-memory-runtime', private: true, description: 'The embedding runtime /sage-memory setup installs.' }, null, 2)}\n`)
  return runNpm(['install', '--prefix', layout.runtimeDir, `${PACKAGE}@${TRANSFORMERS_VERSION}`, '--save-exact', '--no-audit', '--no-fund'], onLine, signal)
}

/** transformers.js under the layout's runtime directory. */
export function transformersRuntime(layout: Layout): Runtime {
  return {
    installed: () => packageReady(layout) && modelPresent(layout),
    packageReady: () => packageReady(layout),
    install: (onLine, signal) => install(layout, onLine, signal),
    load: options => load(layout, options),
  }
}
