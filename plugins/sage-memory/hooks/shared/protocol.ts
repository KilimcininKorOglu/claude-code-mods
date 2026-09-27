/**
 * The wire contract between the hooks module and the daemon. Pure types and constants, imported
 * by both sides.
 */

/** Raised whenever a route or a payload changes shape; a daemon on another protocol is not used. */
export const PROTOCOL = 1

/** What `GET /hello` answers without a token: enough to tell that a daemon runs, and which build. */
export type Hello = {
  name: 'sage-memory'
  version: string
  protocol: number
  pid: number
  startedAt: string
}

/** The envelope every other route answers in. */
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * The project a request is about: the key of its store directory, a name to show, the root the
 * session works in (anchor paths are relative to it), and the git common dir the key comes from.
 */
export type ProjectRef = { key: string; name: string; root: string; commonDir: string }

/** The largest request body the daemon reads. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** The embedding model and the package that runs it; `/sage-memory setup` installs both. */
export const EMBED_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
export const TRANSFORMERS_VERSION = '4.3.0'

/**
 * The daemon's embeddings: `off` until setup installed the runtime, `available` until the first
 * use loads the model, `failed` with the reason when loading or embedding failed. In every state
 * but `ready` a search reads the text index alone.
 */
export type EmbedState =
  | { state: 'off' }
  | { state: 'available' }
  | { state: 'loading' }
  | { state: 'ready'; modelId: string; dims: number }
  | { state: 'failed'; error: string }

export type SetupStep = 'install' | 'download' | 'index'

/** The setup job: install the package, download the model, then embed the memories of every store. */
export type SetupJob =
  | { state: 'idle' }
  | { state: 'running'; step: SetupStep; detail: string; startedAt: string }
  | { state: 'done'; indexed: number; startedAt: string; finishedAt: string }
  | { state: 'failed'; step: SetupStep; error: string; startedAt: string; finishedAt: string }

/** What `/embed/status` answers. */
export type EmbedStatus = { embedding: EmbedState; setup: SetupJob }

/** What `POST /status` answers. */
export type Status = { pid: number; version: string; protocol: number; uptimeMs: number; stores: string[]; embedding: EmbedState }

/** What `server.json` holds while a daemon owns the socket: the owner, and the token every route but `/hello` needs. */
export type ServerFile = { pid: number; version: string; protocol: number; token: string; startedAt: string }

/**
 * The one line `daemon/launch.ts` prints. `started` is false when a daemon already answered;
 * `replaced` is the older daemon a launch stopped because it spoke another protocol.
 */
export type Launch = { ready: true; started: boolean; hello: Hello; replaced?: Hello } | { ready: false; error: string; log?: string }
