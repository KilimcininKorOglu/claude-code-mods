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

/** What `POST /status` answers. */
export type Status = { pid: number; version: string; protocol: number; uptimeMs: number; stores: string[] }

/** What `server.json` holds while a daemon owns the socket: the owner, and the token every route but `/hello` needs. */
export type ServerFile = { pid: number; version: string; protocol: number; token: string; startedAt: string }

/**
 * The one line `daemon/launch.ts` prints. `started` is false when a daemon already answered;
 * `replaced` is the older daemon a launch stopped because it spoke another protocol.
 */
export type Launch = { ready: true; started: boolean; hello: Hello; replaced?: Hello } | { ready: false; error: string; log?: string }
