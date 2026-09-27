import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { layoutOf, type Layout } from '../hooks/shared/layout.ts'
import { MAX_BODY_BYTES, PROTOCOL, type Hello, type ServerFile, type Status } from '../hooks/shared/protocol.ts'
import { embedRoutes } from './embed-routes.ts'
import { transformersRuntime, type Runtime } from './embedder.ts'
import { createEmbeddings, type Embeddings } from './embeddings.ts'
import { RequestError } from './errors.ts'
import { inodeOf, readIfExists, writeAtomic } from './files.ts'
import { authorized, parseBody, probe, readBody, send } from './http.ts'
import { takeLock } from './lock.ts'
import { log, messageOf } from './log.ts'
import { readRoutes } from './read-routes.ts'
import { remindRoutes } from './remind-routes.ts'
import { memoryRoutes, type Route, type RouteInput, type Routes } from './routes.ts'
import { createSetup, type Setup } from './setup.ts'
import { createStores, type Stores } from './stores.ts'

export type ServerOptions = {
  dir: string
  version: string
  /** The daemon closes this long after its last request ended. */
  idleMs: number
  /** The protocol `/hello` names; a test starts an older or newer daemon with it. */
  protocol?: number
  /** How long the election waits for a live process that holds the lock. */
  lockWaitMs?: number
  /** The embedding runtime: transformers.js under `runtime/` unless a test gives its own. */
  runtime?: Runtime
}

export type Started =
  | { owned: true; token: string; close: (reason: string) => Promise<void>; closed: Promise<void> }
  | { owned: false; hello: Hello }

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void }

type State = {
  layout: Layout
  options: ServerOptions
  hello: Hello
  token: string
  stores: Stores
  embeddings: Embeddings
  setup: Setup
  server: Server
  /** The inode of the socket this daemon listens on, so it removes that socket file and no other. */
  ino: number | undefined
  inflight: number
  idle?: NodeJS.Timeout
  sweep?: NodeJS.Timeout
  closing?: Promise<void>
  /** Settles when a close has finished, however it started. */
  done: Deferred
}

const PROBE_MS = 1000
const LOCK_WAIT_MS = 5000
const STORE_IDLE_MS = 10 * 60_000
const SWEEP_MS = 60_000
/** How long a closing daemon waits for open connections before it cuts them. */
const DRAIN_MS = 5000

function statusOf(state: State): Status {
  const { pid, version, protocol, startedAt } = state.hello
  return { pid, version, protocol, uptimeMs: Date.now() - Date.parse(startedAt), stores: state.stores.names(), embedding: state.embeddings.state() }
}

function routesOf(state: State): Routes {
  const shutdown = ({ res }: RouteInput): { pid: number } => {
    res.once('close', () => void close(state, 'shutdown'))
    return { pid: process.pid }
  }
  return {
    '/hello': { method: 'GET', auth: false, handle: () => state.hello },
    '/status': { method: 'POST', auth: true, handle: () => statusOf(state) },
    '/shutdown': { method: 'POST', auth: true, handle: shutdown },
    ...memoryRoutes(state.stores, state.embeddings),
    ...readRoutes(state.stores, state.embeddings),
    ...remindRoutes(state.stores, state.embeddings),
    ...embedRoutes(state.embeddings, state.setup),
  }
}

function routeFor(routes: Routes, req: IncomingMessage): Route {
  const path = new URL(req.url ?? '/', 'http://daemon').pathname
  const route = Object.hasOwn(routes, path) ? routes[path] : undefined
  if (route === undefined) throw new RequestError(404, `no route ${path}`)
  if (req.method !== route.method) throw new RequestError(405, `${path} takes ${route.method}`)
  return route
}

function fail(req: IncomingMessage, res: ServerResponse, err: unknown): void {
  req.resume()
  const status = err instanceof RequestError ? err.status : 500
  if (status === 500) log(`${req.method} ${req.url}: ${messageOf(err)}`)
  if (res.headersSent) {
    res.destroy()
    return
  }
  if (status === 503) res.setHeader('connection', 'close')
  send(res, status, { ok: false, error: messageOf(err) })
}

async function dispatch(state: State, routes: Routes, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const route = routeFor(routes, req)
    if (state.closing) throw new RequestError(503, 'the daemon is closing')
    if (route.auth && !authorized(req, state.token)) throw new RequestError(401, 'the request carries no valid token')
    const body = route.method === 'POST' ? parseBody(await readBody(req, MAX_BODY_BYTES)) : {}
    send(res, 200, { ok: true, value: await route.handle({ body, res }) })
  } catch (err) {
    fail(req, res, err)
  }
}

/** The idle close waits while setup or an embedding fill still runs, since no request marks that work. */
function armIdle(state: State): void {
  clearTimeout(state.idle)
  state.idle = setTimeout(() => {
    if (state.setup.running() || state.embeddings.busy()) armIdle(state)
    else void close(state, 'idle')
  }, state.options.idleMs)
}

function onRequest(state: State, routes: Routes, req: IncomingMessage, res: ServerResponse): void {
  state.inflight++
  clearTimeout(state.idle)
  res.once('close', () => {
    state.inflight--
    if (state.inflight === 0 && !state.closing) armIdle(state)
  })
  void dispatch(state, routes, req, res)
}

/** The pid `server.json` names, or undefined when there is no file or it does not parse. */
function serverFileOwner(path: string): number | undefined {
  const text = readIfExists(path)
  if (text === undefined) return undefined
  try {
    return (JSON.parse(text) as Partial<ServerFile>).pid
  } catch (err) {
    log(`${path} does not parse, so it stays: ${messageOf(err)}`)
    return undefined
  }
}

/** Removes the socket and `server.json` while they are this daemon's own, never a successor's. */
function removeOwnFiles(state: State): void {
  const { socket, serverFile } = state.layout
  if (state.ino !== undefined && inodeOf(socket) === state.ino) rmSync(socket, { force: true })
  if (serverFileOwner(serverFile) === process.pid) rmSync(serverFile, { force: true })
}

async function shutDown(state: State, reason: string): Promise<void> {
  log(`closing (${reason})`)
  clearTimeout(state.idle)
  clearInterval(state.sweep)
  const drained = new Promise<void>(resolve => state.server.close(() => resolve()))
  removeOwnFiles(state)
  const cut = setTimeout(() => state.server.closeAllConnections(), DRAIN_MS)
  await drained
  clearTimeout(cut)
  await state.setup.stop()
  await state.embeddings.close()
  state.stores.closeAll()
  log('closed')
}

function close(state: State, reason: string): Promise<void> {
  if (!state.closing) {
    state.closing = shutDown(state, reason)
    state.closing.then(state.done.resolve, state.done.reject)
  }
  return state.closing
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/**
 * Listens on a temporary socket, then renames it onto the real path. Node removes the path it
 * listened on when the server closes, so a daemon that listened on the real path would remove a
 * successor's socket; the temporary name is gone by then. The name is never longer than the real
 * one, so it fits wherever the real path fits.
 */
async function takeSocket(state: State): Promise<void> {
  const { dir, socket, serverFile } = state.layout
  const temp = `${dir}/sock.${process.pid.toString(36)}`
  rmSync(temp, { force: true })
  await listen(state.server, temp)
  chmodSync(temp, 0o600)
  state.ino = inodeOf(temp)
  const { pid, version, protocol, startedAt } = state.hello
  const file: ServerFile = { pid, version, protocol, token: state.token, startedAt }
  writeAtomic(serverFile, `${JSON.stringify(file, null, 2)}\n`)
  renameSync(temp, socket)
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((onDone, onError) => {
    resolve = onDone
    reject = onError
  })
  return { promise, resolve, reject }
}

function newState(layout: Layout, options: ServerOptions): State {
  const hello: Hello = {
    name: 'sage-memory',
    version: options.version,
    protocol: options.protocol ?? PROTOCOL,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }
  const token = randomBytes(16).toString('hex')
  const stores = createStores(layout.dir)
  const runtime = options.runtime ?? transformersRuntime(layout)
  const embeddings = createEmbeddings(runtime)
  const setup = createSetup({ dir: layout.dir, runtime, embeddings, stores })
  return { layout, options, hello, token, stores, embeddings, setup, server: createServer(), ino: undefined, inflight: 0, done: deferred() }
}

async function serve(layout: Layout, options: ServerOptions): Promise<Started> {
  const state = newState(layout, options)
  const routes = routesOf(state)
  state.server.on('request', (req: IncomingMessage, res: ServerResponse) => onRequest(state, routes, req, res))
  try {
    await takeSocket(state)
  } catch (err) {
    removeOwnFiles(state)
    if (state.server.listening) state.server.close()
    throw err
  }
  state.server.on('error', err => log(`server error: ${messageOf(err)}`))
  state.sweep = setInterval(() => {
    const count = state.stores.closeIdle(Date.now(), STORE_IDLE_MS)
    if (count > 0) log(`closed ${count} idle store(s)`)
  }, SWEEP_MS)
  state.sweep.unref()
  armIdle(state)
  log(`started: pid ${process.pid}, version ${state.hello.version}, protocol ${state.hello.protocol}, ${layout.socket}`)
  return { owned: true, token: state.token, close: reason => close(state, reason), closed: state.done.promise }
}

/**
 * Starts the daemon unless one already answers on the socket. The election runs under a lock
 * file, so two daemons started at once never both take the socket.
 */
export async function startServer(options: ServerOptions): Promise<Started> {
  const layout = layoutOf(options.dir)
  mkdirSync(layout.dir, { recursive: true, mode: 0o700 })
  const release = await takeLock(layout.lockFile, options.lockWaitMs ?? LOCK_WAIT_MS)
  try {
    const found = await probe(layout.socket, PROBE_MS)
    if (found.state === 'alive') return { owned: false, hello: found.hello }
    if (found.state === 'silent') throw new Error(`a process holds ${layout.socket} but gives no hello: ${found.reason}`)
    return await serve(layout, options)
  } finally {
    release()
  }
}
