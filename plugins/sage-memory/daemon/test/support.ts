import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { layoutOf } from '../../hooks/shared/layout.ts'
import type { Launch, ServerFile } from '../../hooks/shared/protocol.ts'
import { call } from '../http.ts'
import { isAlive } from '../lock.ts'
import { readIfExists } from '../files.ts'

const made: string[] = []

/** A new directory under the OS temp dir, short enough for a socket path. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sm-'))
  made.push(dir)
  return dir
}

async function stopLeftover(dir: string): Promise<void> {
  const text = readIfExists(layoutOf(dir).serverFile)
  const pid = text === undefined ? undefined : (JSON.parse(text) as ServerFile).pid
  if (pid !== undefined && pid !== process.pid && isAlive(pid)) {
    process.kill(pid, 'SIGTERM')
    await waitGone(pid)
  }
}

/** Stops every daemon a test directory still names and removes every directory; the first failure is thrown after. */
export async function cleanUp(): Promise<void> {
  const failures: unknown[] = []
  for (const dir of made.splice(0)) {
    await stopLeftover(dir).catch((err: unknown) => failures.push(err))
    rmSync(dir, { recursive: true, force: true })
  }
  if (failures.length > 0) throw failures[0]
}

export async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)
    await sleep(20)
  }
}

export function waitGone(pid: number, timeoutMs = 5000): Promise<void> {
  return waitFor(() => !isAlive(pid), timeoutMs, `pid ${pid} to exit`)
}

export function serverFileOf(dir: string): ServerFile {
  return JSON.parse(readFileSync(layoutOf(dir).serverFile, 'utf8')) as ServerFile
}

/** Stops the daemon `server.json` names through `/shutdown` and waits for its process to end. */
export async function stopDaemon(dir: string): Promise<void> {
  const file = serverFileOf(dir)
  const answer = await call(layoutOf(dir).socket, '/shutdown', { method: 'POST', token: file.token, timeoutMs: 2000 })
  if (answer.status !== 200) throw new Error(`/shutdown answered HTTP ${answer.status}`)
  await waitGone(file.pid)
}

const LAUNCH = fileURLToPath(new URL('../launch.ts', import.meta.url))

export type LaunchRun = { outcome: Launch; exitCode: number }

/** Runs the launcher as the hooks module does, as a process of its own. */
export function runLauncher(dir: string, env: Record<string, string> = {}): Promise<LaunchRun> {
  return new Promise((resolve, reject) => {
    const args = ['--disable-warning=ExperimentalWarning', LAUNCH, '--dir', dir]
    execFile(process.execPath, args, { env: { ...process.env, ...env }, timeout: 20_000 }, (err, stdout, stderr) => {
      const exitCode = err === null ? 0 : typeof err.code === 'number' ? err.code : -1
      if (exitCode === -1) {
        reject(new Error(`the launcher did not finish: ${err?.message ?? ''} ${stderr}`))
        return
      }
      try {
        resolve({ outcome: JSON.parse(stdout) as Launch, exitCode })
      } catch {
        reject(new Error(`the launcher printed no JSON line: ${stdout} ${stderr}`))
      }
    })
  })
}
