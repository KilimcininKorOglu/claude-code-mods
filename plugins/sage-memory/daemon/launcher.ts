import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, mkdirSync, openSync, readSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { layoutOf, MAX_SOCKET_BYTES, utf8Bytes, type Layout } from '../hooks/shared/layout.ts'
import type { Hello, Launch, ServerFile } from '../hooks/shared/protocol.ts'
import { readIfExists, sizeOf, writeAtomic } from './files.ts'
import { call, probe } from './http.ts'
import { messageOf } from './log.ts'

/**
 * Makes sure a daemon of this plugin's protocol answers on the socket, starting one when none
 * does. `launch.ts` runs it and prints the outcome; the hooks module runs that script with
 * `$.process.run`, so the daemon started here is detached and writes to daemon.log, never to the
 * launching process's pipes.
 */

const PROBE_MS = 2000
const WAIT_MS = 8000
const POLL_MS = 100
const STOP_MS = 5000
const LOG_LIMIT = 1024 * 1024
const LOG_KEEP = 256 * 1024
const TAIL_BYTES = 4096
const TAIL_LINES = 20

/** The version and protocol of the plugin that launches. */
export type Own = { version: string; protocol: number }
type Verdict = 'use' | 'replace' | 'newer'

/** Compares dotted version numbers segment by segment; a missing segment is 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(part => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

/** A daemon of the same protocol is used whatever its version; one of another protocol is replaced unless it is newer. */
export function verdictOf(hello: Hello, own: Own): Verdict {
  if (hello.protocol === own.protocol) return 'use'
  return compareVersions(hello.version, own.version) > 0 ? 'newer' : 'replace'
}

function note(layout: Layout, text: string): void {
  appendFileSync(layout.logFile, `${new Date().toISOString()} launch: ${text}\n`, { mode: 0o600 })
}

/** Cuts daemon.log to its last 256 KB, from a line start, once it has passed 1 MB. */
export function trimLog(file: string): void {
  const size = sizeOf(file)
  if (size === undefined || size <= LOG_LIMIT) return
  const text = readTail(file, size, LOG_KEEP)
  writeAtomic(file, text.slice(text.indexOf('\n') + 1))
}

function readTail(file: string, size: number, bytes: number): string {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(bytes, size))
    const read = readSync(fd, buffer, 0, buffer.length, size - buffer.length)
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** The last lines of daemon.log, for a launch that failed. */
function logTail(file: string): string | undefined {
  const size = sizeOf(file)
  if (size === undefined) return undefined
  return readTail(file, size, TAIL_BYTES).trimEnd().split('\n').slice(-TAIL_LINES).join('\n')
}

/** Asks an older daemon to stop through `/shutdown`, with the token its own `server.json` holds. */
async function stopOld(layout: Layout, hello: Hello): Promise<void> {
  const text = readIfExists(layout.serverFile)
  const file = text === undefined ? undefined : (JSON.parse(text) as Partial<ServerFile>)
  if (file?.pid !== hello.pid || typeof file.token !== 'string') {
    throw new Error(`server.json does not name the daemon of pid ${hello.pid} that answers on the socket`)
  }
  note(layout, `stopping the daemon of pid ${hello.pid} (version ${hello.version}, protocol ${hello.protocol})`)
  const answer = await call(layout.socket, '/shutdown', { method: 'POST', token: file.token, timeoutMs: STOP_MS })
  if (answer.status !== 200) throw new Error(`the daemon of pid ${hello.pid} refused /shutdown with HTTP ${answer.status}`)
  const deadline = Date.now() + STOP_MS
  while ((await probe(layout.socket, PROBE_MS)).state === 'alive') {
    if (Date.now() >= deadline) throw new Error(`the daemon of pid ${hello.pid} still answers ${STOP_MS} ms after /shutdown`)
    await sleep(POLL_MS)
  }
}

function spawnDaemon(layout: Layout): ChildProcess {
  const main = fileURLToPath(new URL('./main.ts', import.meta.url))
  const out = openSync(layout.logFile, 'a', 0o600)
  try {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, '--dir', layout.dir], {
      cwd: layout.dir,
      detached: true,
      stdio: ['ignore', out, out],
    })
    child.unref()
    return child
  } finally {
    closeSync(out)
  }
}

type Exit = { code: number | null; signal: NodeJS.Signals | null }

function exitText(exit: Exit): string {
  return exit.signal === null ? `exited with code ${exit.code}` : `was killed by ${exit.signal}`
}

/**
 * Waits until a daemon gives its hello. A daemon that exits with 0 lost the election to another
 * one, so the wait goes on; any other exit ends it.
 */
async function awaitHello(layout: Layout, child: ChildProcess): Promise<Hello> {
  let exit: Exit | undefined
  let spawnError: Error | undefined
  child.once('exit', (code, signal) => {
    exit = { code, signal }
  })
  child.once('error', err => {
    spawnError = err
  })
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const found = await probe(layout.socket, PROBE_MS)
    if (found.state === 'alive') return found.hello
    if (spawnError) throw new Error(`the daemon did not start: ${spawnError.message}`)
    if (exit && (exit.code !== 0 || exit.signal !== null)) throw new Error(`the daemon ${exitText(exit)} before it answered`)
    if (Date.now() >= deadline) throw new Error(`the daemon gave no hello in ${WAIT_MS} ms`)
    await sleep(POLL_MS)
  }
}

/** Starts a daemon and checks that the one answering speaks this plugin's protocol. */
async function start(layout: Layout, own: Own): Promise<Hello> {
  trimLog(layout.logFile)
  const hello = await awaitHello(layout, spawnDaemon(layout))
  if (hello.protocol !== own.protocol) {
    throw new Error(`the daemon of pid ${hello.pid} speaks protocol ${hello.protocol}, this plugin ${own.protocol}`)
  }
  return hello
}

/** Uses, replaces or starts the daemon. Every failure is thrown, with its reason. */
async function launchOnce(layout: Layout, own: Own): Promise<Launch> {
  const found = await probe(layout.socket, PROBE_MS)
  if (found.state === 'silent') throw new Error(`a process holds ${layout.socket} but gives no hello: ${found.reason}`)
  if (found.state === 'absent') return { ready: true, started: true, hello: await start(layout, own) }
  const verdict = verdictOf(found.hello, own)
  if (verdict === 'use') return { ready: true, started: false, hello: found.hello }
  if (verdict === 'newer') {
    const { pid, version, protocol } = found.hello
    throw new Error(`the daemon of pid ${pid} is newer (version ${version}, protocol ${protocol}) than this plugin (version ${own.version}, protocol ${own.protocol})`)
  }
  await stopOld(layout, found.hello)
  return { ready: true, started: true, hello: await start(layout, own), replaced: found.hello }
}

/** Makes sure a daemon of `own` protocol answers under `dir`; a failure is a `ready: false` outcome with the log's last lines. */
export async function launch(dir: string, own: Own): Promise<Launch> {
  const layout = layoutOf(dir)
  const bytes = utf8Bytes(layout.socket)
  if (bytes > MAX_SOCKET_BYTES) return { ready: false, error: `the socket path ${layout.socket} is ${bytes} bytes, over ${MAX_SOCKET_BYTES}` }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return await launchOnce(layout, own)
  } catch (err) {
    return { ready: false, error: messageOf(err), log: logTail(layout.logFile) }
  }
}
