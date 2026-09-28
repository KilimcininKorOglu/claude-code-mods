import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { layoutOf } from '../../hooks/shared/layout.ts'
import { PROTOCOL, type Hello, type Launch } from '../../hooks/shared/protocol.ts'
import { probe } from '../http.ts'
import { compareVersions, trimLog, verdictOf } from '../launcher.ts'
import { startServer } from '../server.ts'
import { cleanUp, runLauncher, serverFileOf, stopDaemon, tempDir, waitGone } from './support.ts'

after(cleanUp)

type Ready = Extract<Launch, { ready: true }>

function ready(outcome: Launch): Ready {
  if (!outcome.ready) throw new Error(`the launch failed: ${outcome.error}\n${outcome.log ?? ''}`)
  return outcome
}

function failed(outcome: Launch): Extract<Launch, { ready: false }> {
  if (outcome.ready) throw new Error(`the launch was ready with the daemon of pid ${outcome.hello.pid}`)
  return outcome
}

function hello(version: string, protocol: number): Hello {
  return { name: 'sage-memory', version, protocol, pid: 1, startedAt: '' }
}

describe('launcher', () => {
  test('starts a daemon, and the next launch uses the one that runs', async () => {
    const dir = tempDir()
    const first = await runLauncher(dir)
    assert.equal(first.exitCode, 0)
    const started = ready(first.outcome)
    assert.equal(started.started, true)
    assert.equal(started.hello.protocol, PROTOCOL)
    assert.notEqual(started.hello.pid, process.pid)
    const second = ready((await runLauncher(dir)).outcome)
    assert.equal(second.started, false)
    assert.equal(second.hello.pid, started.hello.pid)
    assert.equal(serverFileOf(dir).pid, started.hello.pid)
    assert.match(readFileSync(layoutOf(dir).logFile, 'utf8'), new RegExp(`started: pid ${started.hello.pid}`))
    await stopDaemon(dir)
    assert.equal(existsSync(layoutOf(dir).socket), false)
  })

  test('two launches at once end with one daemon', async () => {
    const dir = tempDir()
    const [a, b] = await Promise.all([runLauncher(dir), runLauncher(dir)])
    assert.equal(ready(a.outcome).hello.pid, ready(b.outcome).hello.pid)
    assert.equal(serverFileOf(dir).pid, ready(a.outcome).hello.pid)
    await stopDaemon(dir)
  })

  test('the daemon exits SAGE_MEMORY_IDLE_MS after its last request and removes its files', async () => {
    const dir = tempDir()
    const run = ready((await runLauncher(dir, { SAGE_MEMORY_IDLE_MS: '300' })).outcome)
    await waitGone(run.hello.pid)
    assert.equal(existsSync(layoutOf(dir).socket), false)
    assert.equal(existsSync(layoutOf(dir).serverFile), false)
    assert.match(readFileSync(layoutOf(dir).logFile, 'utf8'), /closing \(idle\)/)
  })

  test('a daemon that fails at its start is reported with its log', async () => {
    const dir = tempDir()
    const run = await runLauncher(dir, { SAGE_MEMORY_IDLE_MS: 'soon' })
    assert.equal(run.exitCode, 1)
    const outcome = failed(run.outcome)
    assert.match(outcome.error, /exited with code 1 before it answered/)
    assert.match(outcome.log ?? '', /SAGE_MEMORY_IDLE_MS is not a whole number of milliseconds: "soon"/)
  })

  test('a socket path over 100 bytes is refused before anything is made', async () => {
    const dir = join(tempDir(), 'x'.repeat(80))
    const run = await runLauncher(dir)
    assert.equal(run.exitCode, 1)
    assert.match(failed(run.outcome).error, /bytes, over 100$/)
    assert.equal(existsSync(dir), false)
  })

  test('a daemon of an older protocol is stopped and replaced', async () => {
    const dir = tempDir()
    const old = await startServer({ dir, version: '0.0.1', protocol: PROTOCOL - 1, idleMs: 60_000 })
    if (!old.owned) throw new Error('the older daemon did not start')
    const run = ready((await runLauncher(dir)).outcome)
    await old.closed
    assert.equal(run.started, true)
    assert.equal(run.replaced?.pid, process.pid)
    assert.equal(run.replaced?.protocol, PROTOCOL - 1)
    assert.equal(run.hello.protocol, PROTOCOL)
    assert.match(readFileSync(layoutOf(dir).logFile, 'utf8'), new RegExp(`launch: stopping the daemon of pid ${process.pid}`))
    await stopDaemon(dir)
  })

  test('a daemon of a newer protocol keeps running, and the launch says why it stops', async () => {
    const dir = tempDir()
    const newer = await startServer({ dir, version: '99.0.0', protocol: PROTOCOL + 1, idleMs: 60_000 })
    if (!newer.owned) throw new Error('the newer daemon did not start')
    try {
      const run = await runLauncher(dir)
      assert.equal(run.exitCode, 1)
      assert.match(failed(run.outcome).error, /is newer \(version 99\.0\.0, protocol \d+\) than this plugin/)
      const found = await probe(layoutOf(dir).socket, 1000)
      assert.equal(found.state === 'alive' && found.hello.protocol, PROTOCOL + 1)
    } finally {
      await newer.close('test')
    }
  })
})

describe('launch rules', () => {
  test('versions compare by number, segment by segment', () => {
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1)
    assert.equal(compareVersions('1.0', '1.0.0'), 0)
    assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
  })

  test('an older version is replaced, a newer one of another protocol stops the launch', () => {
    const own = { version: '0.2.0', protocol: 2 }
    assert.equal(verdictOf(hello('0.9.0', 2), own), 'use', 'an older plugin of the same protocol uses the newer daemon')
    assert.equal(verdictOf(hello('0.2.0', 2), own), 'use')
    assert.equal(verdictOf(hello('0.1.0', 2), own), 'replace', 'the daemon an older install left running')
    assert.equal(verdictOf(hello('0.1.0', 1), own), 'replace')
    assert.equal(verdictOf(hello('0.2.0', 1), own), 'replace', 'one version on two protocols is a development build')
    assert.equal(verdictOf(hello('0.3.0', 3), own), 'newer')
  })

  test('daemon.log over 1 MB is cut to its last 256 KB from a line start', () => {
    const file = join(tempDir(), 'daemon.log')
    const lines = Array.from({ length: 30_000 }, (_, i) => `2026-09-27T00:00:00.000Z line ${i} ${'.'.repeat(20)}`)
    writeFileSync(file, `${lines.join('\n')}\n`)
    trimLog(file)
    const text = readFileSync(file, 'utf8')
    assert.ok(text.length <= 256 * 1024, `${text.length} bytes kept`)
    assert.match(text, /^2026-09-27T00:00:00\.000Z line \d+ /)
    assert.ok(text.endsWith(`${lines.at(-1)}\n`))
  })

  test('a log under 1 MB stays as it is', () => {
    const file = join(tempDir(), 'daemon.log')
    writeFileSync(file, 'one line\n')
    trimLog(file)
    assert.equal(readFileSync(file, 'utf8'), 'one line\n')
    trimLog(join(tempDir(), 'missing.log'))
  })
})
