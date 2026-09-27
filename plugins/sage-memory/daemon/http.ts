import { timingSafeEqual } from 'node:crypto'
import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Hello } from '../hooks/shared/protocol.ts'
import { RequestError } from './errors.ts'
import { codeOf, messageOf } from './log.ts'

/**
 * Reads a request body up to `limit` bytes. A longer body is drained, not kept, and rejects with
 * 413 once it has ended, so the client still reads an answer.
 */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > limit) reject(new RequestError(413, `the request body is over ${limit} bytes`))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/** Parses a JSON object body; an empty body is `{}`. */
export function parseBody(text: string): Record<string, unknown> {
  if (text.trim() === '') return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new RequestError(400, 'the request body is not JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'the request body is not a JSON object')
  return value as Record<string, unknown>
}

export function send(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

/** Whether the request carries `Bearer <token>`, compared in constant time. */
export function authorized(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? '')
  const wanted = Buffer.from(`Bearer ${token}`)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** The daemon's hello out of a `/hello` reply envelope, or undefined when the reply is not one. */
export function helloOf(reply: unknown): Hello | undefined {
  const value = (reply as { value?: unknown } | null)?.value
  const hello = value as Partial<Hello> | null | undefined
  const valid =
    hello?.name === 'sage-memory' &&
    typeof hello.version === 'string' &&
    typeof hello.protocol === 'number' &&
    typeof hello.pid === 'number' &&
    typeof hello.startedAt === 'string'
  return valid ? (hello as Hello) : undefined
}

function readAll(stream: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

/** The JSON value of a reply body, or the body's text when it is not JSON. */
function replyOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export type Answer = { status: number; reply: unknown }

export type CallInit = { method: 'GET' | 'POST'; token?: string; body?: string; timeoutMs: number }

/** Sends one request over the socket on a connection of its own and reads the answer. */
export function call(socket: string, path: string, init: CallInit): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`
    const options = { socketPath: socket, path, method: init.method, headers, timeout: init.timeoutMs, agent: false }
    const req = request(options, res => {
      readAll(res).then(text => resolve({ status: res.statusCode ?? 0, reply: replyOf(text) }), reject)
    })
    req.on('timeout', () => req.destroy(new Error(`no answer to ${path} in ${init.timeoutMs} ms`)))
    req.on('error', reject)
    req.end(init.body)
  })
}

/**
 * What holds the socket: `alive` is a daemon that gave its hello, `absent` is no listener (no
 * file, a file nothing listens on, or not a socket), `silent` is a listener that gave no hello.
 */
export type Probe = { state: 'alive'; hello: Hello } | { state: 'absent' } | { state: 'silent'; reason: string }

const NO_LISTENER = new Set(['ECONNREFUSED', 'ENOENT', 'ENOTSOCK'])

/** Asks the socket for `/hello`. Any failure but the three kinds above throws. */
export async function probe(socket: string, timeoutMs: number): Promise<Probe> {
  let answer: Answer
  try {
    answer = await call(socket, '/hello', { method: 'GET', timeoutMs })
  } catch (err) {
    const code = codeOf(err)
    if (code !== undefined && NO_LISTENER.has(code)) return { state: 'absent' }
    if (code === undefined || code === 'ECONNRESET') return { state: 'silent', reason: messageOf(err) }
    throw err
  }
  const hello = helloOf(answer.reply)
  return hello ? { state: 'alive', hello } : { state: 'silent', reason: `/hello answered HTTP ${answer.status} without a sage-memory hello` }
}
