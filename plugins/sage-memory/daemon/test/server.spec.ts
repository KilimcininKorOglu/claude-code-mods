import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { layoutOf } from '../../hooks/shared/layout.ts'
import { MAX_BODY_BYTES, PROTOCOL } from '../../hooks/shared/protocol.ts'
import { call, probe } from '../http.ts'
import { startServer, type Started } from '../server.ts'
import { fakeRuntime } from './fake-runtime.ts'
import { cleanUp, serverFileOf, tempDir, waitFor } from './support.ts'

after(cleanUp)

type Owned = Extract<Started, { owned: true }>

const VERSION = '9.9.9'

async function own(dir: string, idleMs = 60_000): Promise<Owned> {
  const started = await startServer({ dir, version: VERSION, idleMs })
  if (!started.owned) throw new Error(`the daemon of pid ${started.hello.pid} kept the socket`)
  return started
}

function post(dir: string, path: string, token: string | undefined, body?: string): ReturnType<typeof call> {
  return call(layoutOf(dir).socket, path, { method: 'POST', token, body, timeoutMs: 5000 })
}

type Raw = { server: Server; sockets: Set<Socket> }

/** A plain listener that accepts connections and never answers them. */
function listenRaw(path: string): Promise<Raw> {
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => resolve({ server, sockets }))
  })
}

function closeRaw(raw: Raw): Promise<void> {
  raw.sockets.forEach(socket => socket.destroy())
  return new Promise(resolve => raw.server.close(() => resolve()))
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

describe('daemon server', () => {
  test('/hello answers without a token and names the build', async () => {
    const dir = tempDir()
    const daemon = await own(dir)
    try {
      const found = await probe(layoutOf(dir).socket, 1000)
      assert.equal(found.state, 'alive')
      assert.equal(found.state === 'alive' && found.hello.pid, process.pid)
      assert.equal(found.state === 'alive' && found.hello.version, VERSION)
      assert.equal(found.state === 'alive' && found.hello.protocol, PROTOCOL)
    } finally {
      await daemon.close('test')
    }
  })

  test('every other route needs the token server.json holds', async () => {
    const dir = tempDir()
    const daemon = await own(dir)
    try {
      assert.equal(serverFileOf(dir).token, daemon.token)
      const none = await post(dir, '/status', undefined)
      assert.equal(none.status, 401)
      assert.deepEqual(none.reply, { ok: false, error: 'the request carries no valid token' })
      assert.equal((await post(dir, '/status', `${daemon.token.slice(1)}x`)).status, 401)
      const status = await post(dir, '/status', daemon.token)
      assert.equal(status.status, 200)
      const value = (status.reply as { ok: boolean; value: { pid: number; version: string; stores: string[] } }).value
      assert.equal(value.pid, process.pid)
      assert.equal(value.version, VERSION)
      assert.deepEqual(value.stores, [])
    } finally {
      await daemon.close('test')
    }
  })

  test('a malformed request gets the status that names its fault', async () => {
    const dir = tempDir()
    const daemon = await own(dir)
    const socket = layoutOf(dir).socket
    try {
      assert.equal((await call(socket, '/nowhere', { method: 'GET', timeoutMs: 5000 })).status, 404)
      assert.equal((await call(socket, '/status', { method: 'GET', timeoutMs: 5000 })).status, 405)
      assert.equal((await call(socket, '/__proto__', { method: 'GET', timeoutMs: 5000 })).status, 404)
      assert.equal((await post(dir, '/status', daemon.token, 'not json')).status, 400)
      assert.equal((await post(dir, '/status', daemon.token, '[1]')).status, 400)
      const big = await post(dir, '/status', daemon.token, JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES) }))
      assert.equal(big.status, 413)
      assert.equal((await post(dir, '/status', daemon.token, '{}')).status, 200, 'the daemon still serves after a refused body')
    } finally {
      await daemon.close('test')
    }
  })

  test('its directory, socket and server.json are open to the owner alone', async () => {
    const dir = join(tempDir(), 'fresh')
    const daemon = await own(dir)
    try {
      assert.equal(modeOf(dir), 0o700)
      assert.equal(modeOf(layoutOf(dir).socket), 0o600)
      assert.equal(modeOf(layoutOf(dir).serverFile), 0o600)
      assert.equal(existsSync(layoutOf(dir).lockFile), false, 'the election lock is released')
    } finally {
      await daemon.close('test')
    }
  })

  test('a second daemon on the same directory leaves the socket to the first', async () => {
    const dir = tempDir()
    const daemon = await own(dir)
    try {
      const second = await startServer({ dir, version: '0.0.0', idleMs: 60_000 })
      assert.equal(second.owned, false)
      assert.equal(!second.owned && second.hello.version, VERSION)
      assert.equal((await post(dir, '/status', daemon.token)).status, 200)
    } finally {
      await daemon.close('test')
    }
  })

  test('a socket left by a killed process is taken over', async () => {
    const dir = tempDir()
    const socket = layoutOf(dir).socket
    const code = "require('node:net').createServer().listen(process.argv[1], () => process.stdout.write('up'))"
    const child = spawn(process.execPath, ['-e', code, socket], { stdio: ['ignore', 'pipe', 'inherit'] })
    await once(child.stdout, 'data')
    child.kill('SIGKILL')
    await once(child, 'exit')
    assert.ok(existsSync(socket), 'the killed process left its socket file')
    assert.equal((await probe(socket, 1000)).state, 'absent')
    const daemon = await own(dir)
    try {
      assert.equal((await probe(socket, 1000)).state, 'alive')
    } finally {
      await daemon.close('test')
    }
  })

  test('a plain file at the socket path is replaced', async () => {
    const dir = tempDir()
    writeFileSync(layoutOf(dir).socket, 'not a socket')
    const daemon = await own(dir)
    try {
      assert.equal((await probe(layoutOf(dir).socket, 1000)).state, 'alive')
    } finally {
      await daemon.close('test')
    }
  })

  test('a listener that gives no hello keeps the socket, and the start fails', async () => {
    const dir = tempDir()
    const silent = await listenRaw(layoutOf(dir).socket)
    try {
      await assert.rejects(startServer({ dir, version: VERSION, idleMs: 60_000 }), /holds .*daemon\.sock but gives no hello/)
      assert.equal(existsSync(layoutOf(dir).serverFile), false)
    } finally {
      await closeRaw(silent)
    }
  })

  test('a listener that closes while a probe connects reads as silent, not as a failure', async () => {
    const socket = layoutOf(tempDir()).socket
    const raw = await listenRaw(socket)
    const found = probe(socket, 1000)
    raw.server.close()
    assert.equal((await found).state, 'silent')
  })

  test('a lock whose process is gone is taken over', async () => {
    const dir = tempDir()
    writeFileSync(layoutOf(dir).lockFile, '2147483646')
    const daemon = await own(dir)
    try {
      assert.equal(existsSync(layoutOf(dir).lockFile), false)
    } finally {
      await daemon.close('test')
    }
  })

  test('a live process that holds the lock is waited for, and a lock older than any election is taken over', async () => {
    const dir = tempDir()
    const lock = layoutOf(dir).lockFile
    writeFileSync(lock, String(process.pid))
    await assert.rejects(startServer({ dir, version: VERSION, idleMs: 60_000, lockWaitMs: 150 }), /was held by another process for 150 ms/)
    const old = (Date.now() - 20_000) / 1000
    utimesSync(lock, old, old)
    const daemon = await own(dir)
    await daemon.close('test')
  })

  test('the daemon closes after its idle time and removes its files', async () => {
    const dir = tempDir()
    const daemon = await own(dir, 150)
    assert.equal((await probe(layoutOf(dir).socket, 1000)).state, 'alive')
    await daemon.closed
    assert.equal(existsSync(layoutOf(dir).socket), false)
    assert.equal(existsSync(layoutOf(dir).serverFile), false)
    assert.equal((await probe(layoutOf(dir).socket, 1000)).state, 'absent')
  })

  test('the idle close waits while setup runs, and comes once it ended', async () => {
    const dir = tempDir()
    const fake = fakeRuntime(false)
    let release = (): void => undefined
    fake.hold = new Promise(resolve => {
      release = resolve
    })
    const started = await startServer({ dir, version: VERSION, idleMs: 150, runtime: fake })
    if (!started.owned) throw new Error(`the daemon of pid ${started.hello.pid} kept the socket`)
    assert.equal((await post(dir, '/embed/setup', started.token)).status, 200)
    await sleep(500)
    assert.deepEqual([existsSync(layoutOf(dir).socket), fake.loads.length], [true, 1], 'the daemon is still up while the model downloads')
    release()
    await started.closed
    assert.equal(existsSync(layoutOf(dir).socket), false)
  })

  test('the idle close waits while a hygiene run lasts, and comes once it ended', async () => {
    const dir = tempDir()
    const fake = fakeRuntime(true)
    const started = await startServer({ dir, version: VERSION, idleMs: 150, runtime: fake })
    if (!started.owned) throw new Error(`the daemon of pid ${started.hello.pid} kept the socket`)
    const project = { key: 'repo-0000aaaa', name: 'repo', root: tempDir(), commonDir: '/nowhere/.git' }
    const write = async (path: string, body: object): Promise<{ memory: { id: string } }> => {
      const answer = await post(dir, path, started.token, JSON.stringify({ project, ...body }))
      assert.equal(answer.status, 200, `${path}: ${JSON.stringify(answer.reply)}`)
      return (answer.reply as { value: { memory: { id: string } } }).value
    }
    const kept = await write('/memory/remember', { input: { text: 'A placeholder about the office plants', importance: 0.9 } })
    const merged = await write('/memory/remember', { input: { text: 'Another placeholder about the lunch menu', importance: 0.5 } })
    await write('/memory/update', { id: kept.memory.id, patch: { text: 'Run database migrations with pnpm before starting the dev server' } })
    await write('/memory/update', { id: merged.memory.id, patch: { text: 'Before starting the dev server, run database migrations with pnpm from the repository root' } })
    let release = (): void => undefined
    fake.embedHold = new Promise(resolve => {
      release = resolve
    })
    await write('/memory/hygiene', { automatic: true })
    await sleep(500)
    assert.equal(existsSync(layoutOf(dir).socket), true, 'the run waits to embed the merged text, and no request marks it')
    release()
    await started.closed
    assert.equal(existsSync(layoutOf(dir).socket), false)
  })

  test('/shutdown answers first, then closes the daemon', async () => {
    const dir = tempDir()
    const daemon = await own(dir)
    const answer = await post(dir, '/shutdown', daemon.token)
    assert.deepEqual(answer, { status: 200, reply: { ok: true, value: { pid: process.pid } } })
    await daemon.closed
    assert.equal(existsSync(layoutOf(dir).socket), false)
    assert.equal(existsSync(layoutOf(dir).serverFile), false)
  })

  test("a closing daemon leaves a successor's socket and server.json alone", async () => {
    const dir = tempDir()
    const { socket, serverFile } = layoutOf(dir)
    const daemon = await own(dir)
    const temp = join(dir, 'next.sock')
    const successor = await listenRaw(temp)
    try {
      renameSync(temp, socket)
      const ino = statSync(socket).ino
      writeFileSync(serverFile, JSON.stringify({ pid: 1, version: '1.0.0', protocol: PROTOCOL, token: 'next', startedAt: '' }))
      await daemon.close('test')
      assert.equal(statSync(socket).ino, ino)
      assert.equal(JSON.parse(readFileSync(serverFile, 'utf8')).token, 'next')
    } finally {
      await closeRaw(successor)
      rmSync(socket, { force: true })
      rmSync(serverFile, { force: true })
    }
  })

  test('a daemon closes once, whichever way the close came', async () => {
    const dir = tempDir()
    const daemon = await own(dir)
    const first = daemon.close('first')
    const second = daemon.close('second')
    assert.equal(first, second)
    await first
    await waitFor(() => !existsSync(layoutOf(dir).socket), 1000, 'the socket to go')
  })
})
