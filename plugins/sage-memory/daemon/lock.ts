import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { readIfExists, unlessMissing } from './files.ts'
import { codeOf } from './log.ts'

/** An election takes milliseconds; a lock older than this belongs to a daemon that died holding it. */
const STALE_MS = 10_000
const RETRY_MS = 25

/** Whether a process with this pid runs. EPERM means it runs under another user. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return codeOf(err) !== 'ESRCH'
  }
}

function tryCreate(path: string): boolean {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 })
    return true
  } catch (err) {
    if (codeOf(err) === 'EEXIST') return false
    throw err
  }
}

/** Whether the lock's writer is gone or the lock outlived any election. A vanished lock is not stale. */
function isStale(path: string, now: number): boolean {
  const lock = unlessMissing(() => ({ text: readFileSync(path, 'utf8'), modified: statSync(path).mtimeMs }))
  if (lock === undefined) return false
  if (now - lock.modified > STALE_MS) return true
  const pid = Number(lock.text)
  return Number.isInteger(pid) && pid > 0 && !isAlive(pid)
}

function release(path: string): void {
  if (readIfExists(path) === String(process.pid)) rmSync(path, { force: true })
}

/**
 * Takes the lock file, waiting up to `waitMs` while a live process holds it, and answers the
 * release. Two processes that find the same stale lock can both remove it; that needs a daemon
 * that died inside its own election, and the socket probe inside the lock still runs.
 */
export async function takeLock(path: string, waitMs: number): Promise<() => void> {
  const deadline = Date.now() + waitMs
  for (;;) {
    if (tryCreate(path)) return () => release(path)
    if (isStale(path, Date.now())) {
      rmSync(path, { force: true })
      continue
    }
    if (Date.now() >= deadline) throw new Error(`${path} was held by another process for ${waitMs} ms`)
    await sleep(RETRY_MS)
  }
}
